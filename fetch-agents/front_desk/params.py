"""Order params for catalog APIs that declare them, e.g. open-roles' Greenhouse `board`.

ASI-1 picks the API and reads the raw value from the request ("Lattice"); code turns it into a slug and,
for Greenhouse boards, checks that the board exists and that its page fits one extractor call.
"""

import json
import os
import re
from dataclasses import dataclass, field
from urllib.parse import urlparse

import httpx

from front_desk.intent import _client, _first_json_object

GREENHOUSE_HOST = "boards-api.greenhouse.io"
# forge-extract truncates pages above this, so a bigger board can't be served in full by one call.
MAX_PAGE_CHARS = 60_000
_VALUE_RE = re.compile(r"^[a-z0-9-]{1,60}$")

_SYSTEM = """You match a customer's data request to a catalog of APIs that take parameters. Reply with JSON only:
{"api": str or null, "params": {param_name: str}}
- api: the name of the one catalog API that serves this request, or null if none clearly does.
- params: for that API, each declared param's value as the customer named it (e.g. the company name "Lattice").
  Leave a param out if the request doesn't name it. Never fill in a param's default or guess a value."""


@dataclass
class Resolution:
    api: str | None = None
    params: dict[str, str] = field(default_factory=dict)
    note: str | None = None  # One line for the quote message.


def slug_candidates(name: str) -> list[str]:
    hyphenated = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")[:60].strip("-")
    out = [hyphenated, hyphenated.replace("-", "")]
    return [s for i, s in enumerate(out) if s and _VALUE_RE.match(s) and s not in out[:i]]


def board_exists(board: str) -> bool:
    return httpx.get(f"https://{GREENHOUSE_HOST}/v1/boards/{board}", timeout=15).status_code == 200


def page_chars(url: str) -> int:
    r = httpx.get(url, timeout=30)
    r.raise_for_status()
    return len(r.text)


def _greenhouse_param(sources: list[str], key: str) -> str | None:
    """The source template for a param that is a Greenhouse board token, if this API has one."""
    for src in sources:
        u = urlparse(src)
        if u.hostname == GREENHOUSE_HOST and f"/boards/{{{key}}}" in u.path:
            return src
    return None


def pick_api(text: str, apis: list[dict]) -> tuple[str | None, dict[str, str]]:
    catalog = [{"name": a["name"], "description": a["description"], "params": a["inputs"]} for a in apis]
    resp = _client().chat.completions.create(
        model=os.environ.get("ASI1_MODEL", "asi1"),
        temperature=0,
        messages=[{"role": "system", "content": _SYSTEM},
                  {"role": "user", "content": f"Catalog: {json.dumps(catalog)}\n\nRequest: {text}"}],
    )
    data = _first_json_object(resp.choices[0].message.content or "")
    names = {a["name"] for a in apis}
    api = data.get("api") if data.get("api") in names else None
    raw = data.get("params") if isinstance(data.get("params"), dict) else {}
    return api, {str(k): str(v) for k, v in raw.items() if v not in (None, "")}


def resolve_values(api: dict, raw: dict[str, str]) -> Resolution:
    res = Resolution(api=api["name"])
    for key, value in raw.items():
        if key not in api["inputs"]:
            continue
        template = _greenhouse_param(api["sources"], key)
        candidates = slug_candidates(value)
        if template is None:
            if candidates:
                res.params[key] = candidates[0]
            continue
        board = next((c for c in candidates if board_exists(c)), None)
        if board is None:
            tried = ", ".join(f"`{c}`" for c in candidates) or "no valid board name"
            res.note = (f"I couldn't find a public Greenhouse job board for {value} (tried {tried}). "
                        "The COO will decide whether another source can serve this.")
            continue
        chars = page_chars(template.replace(f"{{{key}}}", board))
        if chars > MAX_PAGE_CHARS:
            res.note = (f"Counteroffer: {value}'s Greenhouse board `{board}` is {chars:,} characters, too large for one "
                        f"call today (limit {MAX_PAGE_CHARS:,}). I haven't attached it to this order; ask for a different "
                        "company, or pay and the COO will decide what it can deliver.")
            continue
        res.params[key] = board
        res.note = f"Source: Greenhouse board `{board}` ({chars:,} characters, fits one call)."
    return res


def resolve(text: str, apis: list[dict]) -> Resolution:
    """Params for the request; empty when no API with declared params fits it."""
    with_params = [a for a in apis if a["inputs"]]
    if not with_params:
        return Resolution()
    name, raw = pick_api(text, with_params)
    if name is None:
        return Resolution()
    return resolve_values(next(a for a in with_params if a["name"] == name), raw)
