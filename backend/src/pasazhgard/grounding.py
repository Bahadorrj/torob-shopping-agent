"""Grounding check: prices, shop ids and availability the agent states must come from tool output."""

import json
import re

from pasazhgard.normalize import normalize

# a price: grouped digits, 4+ digits, or a number with a Persian scale word ("۲ میلیون", "۲.۵ میلیون")
_NUMBER = re.compile(r"(\d+(?:[.٫/]\d+)?)\s*(میلیون|هزار)|\d{1,3}(?:[,٬،]\d{3})+|\d{4,}")
_SHOP = re.compile(r"shop_[0-9a-f]+")
_IN_STOCK = re.compile(r"(?<!نا)موجود(?! نیست)")
_OUT_OF_STOCK = re.compile(r"ناموجود|موجود نیست")


def _prices(text: str) -> set[int]:
    scale = {"میلیون": 1_000_000, "هزار": 1_000}
    out = set()
    for m in _NUMBER.finditer(normalize(text)):
        if m[2]:
            out.add(round(float(m[1].replace("٫", ".").replace("/", ".")) * scale[m[2]]))
        else:
            out.add(int(re.sub(r"\D", "", m[0])))
    return {p for p in out if p >= 1000}


def _known_prices(source: str) -> set[int]:
    """Prices a source backs: a tool result's `*_toman` fields, else every price in the user's own words."""
    try:
        data = json.loads(source)
    except ValueError:
        return _prices(source)
    out, stack = set(), [data]
    while stack:
        node = stack.pop()
        items = node.items() if isinstance(node, dict) else enumerate(node) if isinstance(node, list) else []
        for k, v in items:
            if isinstance(k, str) and k.endswith("_toman") and isinstance(v, int):
                # a delta backs "N cheaper" as well
                out.add(abs(v))
            else:
                stack.append(v)
    return out


def ungrounded(claims: str, sources: list[str]) -> list[str]:
    """The claims in `claims` (agent text) that no source (tool output, the user's own words) backs."""
    source = " ".join(sources)
    known = set().union(*map(_known_prices, sources))
    missing = [f"price {p}" for p in sorted(_prices(claims) - known)]
    missing += [f"shop {s}" for s in sorted(set(_SHOP.findall(claims)) - set(_SHOP.findall(source)))]
    text = normalize(claims)
    if _IN_STOCK.search(text) and not re.search(r'"available":\s*"yes"', source):
        missing.append("in stock")
    if _OUT_OF_STOCK.search(text) and not re.search(r'"available":\s*"no"', source):
        missing.append("out of stock")
    return missing


def ungrounded_turn(messages: list[dict]) -> list[str]:
    """Ungrounded claims in the last turn of an AG-UI thread: the assistant's text and the questions it asks,
    against that turn's tool output and the user's words."""
    turn = messages[max(i for i, m in enumerate(messages) if m["role"] == "user") :]
    claims = [m.get("content") or "" for m in turn if m["role"] == "assistant"]
    sources = [m["content"] for m in turn if m["role"] in ("tool", "user")]
    for m in turn:
        if m["role"] == "tool":
            try:
                claims.append(json.loads(m["content"]).get("question", ""))
            except (ValueError, AttributeError):
                pass
    return ungrounded(" ".join(claims), sources)
