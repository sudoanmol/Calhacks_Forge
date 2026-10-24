"""Intent parse with ASI-1: free-form chat text -> the fields the layer-2 gate needs."""

import json
import os
import re
from dataclasses import dataclass, field

from openai import OpenAI

ASI1_BASE_URL = "https://api.asi1.ai/v1"

_SYSTEM = """You turn a customer's request for public web data into JSON. Reply with JSON only:
{"is_request": bool, "summary": str, "sources": [str], "fields": [str], "estimated_pages": int}
- is_request: true only if the message asks for a dataset from the web. Greetings, complaints, commentary about
  messages, payment words and other chatter are false; then the other keys may be empty.
- summary: one line naming the dataset, e.g. "Open roles at Stripe by team".
- sources: domains or URLs the data would come from. Use the site the customer names; otherwise the most likely public source domain.
- fields: the output columns the customer wants, in their words, e.g. ["price", "stock", "link"].
- estimated_pages: how many distinct web pages would have to be read (listing pages, not items). 1 if unsure."""


# ASI:One forwards the customer's "@agent1..." mention as part of the message text.
_MENTION = re.compile(r"@agent1[0-9a-z]+")


def strip_mentions(text: str) -> str:
    return " ".join(_MENTION.sub(" ", text).split())


class NotARequest(ValueError):
    """The model answered in prose instead of JSON: the message wasn't a data request it could parse."""


@dataclass
class Intent:
    summary: str
    sources: list[str] = field(default_factory=list)
    fields: list[str] = field(default_factory=list)
    estimated_pages: int = 1


def _client() -> OpenAI:
    return OpenAI(api_key=os.environ["ASI1_API_KEY"], base_url=ASI1_BASE_URL)


def _first_json_object(text: str) -> dict:
    start, end = text.find("{"), text.rfind("}")
    if start < 0 or end < start:
        raise NotARequest(f"no JSON object in model reply: {text[:200]!r}")
    return json.loads(text[start : end + 1])


def parse_intent(text: str) -> Intent:
    resp = _client().chat.completions.create(
        model=os.environ.get("ASI1_MODEL", "asi1"),
        temperature=0,
        messages=[{"role": "system", "content": _SYSTEM}, {"role": "user", "content": text}],
    )
    data = _first_json_object(resp.choices[0].message.content or "")
    if data.get("is_request") is False:
        raise NotARequest(f"model says not a data request: {text[:200]!r}")
    return Intent(
        summary=str(data.get("summary", "")).strip(),
        sources=[str(s) for s in data.get("sources", []) if s],
        fields=[str(f) for f in data.get("fields", []) if f],
        estimated_pages=max(1, int(data.get("estimated_pages") or 1)),
    )
