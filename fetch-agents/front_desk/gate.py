"""Layer-2 admission checks (AGENTS.md §3): deterministic, no network, no CREAO run."""

from __future__ import annotations

import re
from dataclasses import dataclass
from urllib.parse import urlparse

# Field names that ask for data about a specific person.
_PERSONAL_FIELD_PATTERNS = [
    r"e-?mails?",
    r"phones?( numbers?)?",
    r"mobile( numbers?)?",
    r"(home|mailing|personal) address(es)?",
    r"linkedin (profiles?|urls?|pages? of (people|employees|engineers|staff|founders))",
    r"(social|twitter|x|instagram|facebook)( media)? (handles?|profiles?|accounts?)",
    r"(full |first |last )?names? of (people|employees|engineers|staff|users|customers|founders|candidates|members)",
    r"(employee|engineer|staff|user|customer|candidate|member|founder|person|people)('?s)? (names?|contacts?|details?)",
    r"contact (info|information|details)",
    r"date of birth|birthdays?|dob",
    r"ssn|social security( numbers?)?",
    r"home towns?",
    r"salar(y|ies) of (people|employees|[a-z]+ engineers)",
]
_PERSONAL_RE = re.compile(r"\b(" + "|".join(_PERSONAL_FIELD_PATTERNS) + r")\b", re.IGNORECASE)

# "names" is fine for companies, products or roles; only flag it when the entity is a person.
_PERSON_ENTITY_RE = re.compile(
    r"\b(names?|who)\b.{0,40}\b(people|employees|engineers|staff|founders|ceos?|candidates|users|customers|members|recruiters|hiring managers)\b"
    r"|\b(people|employees|engineers|staff|founders|ceos?|candidates|users|customers|members|recruiters|hiring managers)\b.{0,20}\bnames?\b",
    re.IGNORECASE,
)


@dataclass(frozen=True)
class GateResult:
    passed: bool
    check: str
    reason: str = ""
    counteroffer_pages: int | None = None


def personal_data_check(fields: list[str], request_text: str = "") -> GateResult:
    hits = sorted({m.group(0).lower() for f in fields for m in _PERSONAL_RE.finditer(f)})
    if not hits and request_text:
        hits = sorted({m.group(0).lower() for m in _PERSONAL_RE.finditer(request_text)})
        if not hits and _PERSON_ENTITY_RE.search(request_text):
            hits = ["names of people"]
    if hits:
        return GateResult(
            False,
            "personal_data",
            f"FORGE only sells public, non-personal data. The request asks for personal data ({', '.join(hits)}). "
            "Counts are fine (for example, the number of engineers by team); names and contact details are not.",
        )
    return GateResult(True, "personal_data")


def _host(url_or_domain: str) -> str:
    s = url_or_domain.strip().lower()
    host = urlparse(s if "://" in s else f"https://{s}").hostname or ""
    return host[4:] if host.startswith("www.") else host


def blocked_domain_check(sources: list[str], blocked_domains: list[str]) -> GateResult:
    blocked = {_host(d) for d in blocked_domains if d.strip()}
    for src in sources:
        host = _host(src)
        for b in blocked:
            if host == b or host.endswith("." + b):
                return GateResult(
                    False,
                    "blocked_domain",
                    f"{b} only shows this data behind a login, so FORGE can't collect or verify it.",
                )
    return GateResult(True, "blocked_domain")


def page_cap_check(estimated_pages: int, page_cap: int) -> GateResult:
    if estimated_pages > page_cap:
        return GateResult(
            False,
            "page_cap",
            f"The request covers about {estimated_pages} pages; FORGE's cap is {page_cap}. Counteroffer: the top {page_cap} pages.",
            counteroffer_pages=page_cap,
        )
    return GateResult(True, "page_cap")


def run_layer2(
    *, fields: list[str], sources: list[str], request_text: str, estimated_pages: int,
    blocked_domains: list[str], page_cap: int,
) -> GateResult:
    """Cheapest first. The first failure wins; page cap is a counteroffer, not a rejection."""
    for result in (
        personal_data_check(fields, request_text),
        blocked_domain_check(sources, blocked_domains),
        page_cap_check(estimated_pages, page_cap),
    ):
        if not result.passed:
            return result
    return GateResult(True, "layer2")
