"""Grounding check (PRD 6.7): prices, shop ids and availability the agent states must come from tool output."""

import re

from pasazhgard.normalize import normalize

# a price: grouped digits, 4+ digits, or a number with a Persian scale word ("۲ میلیون", "۲.۵ میلیون")
_NUMBER = re.compile(r"(\d+(?:[.٫/]\d+)?)\s*(میلیون|هزار)|\d{1,3}(?:[,٬،]\d{3})+|\d{4,}")
_SCALE = {"میلیون": 1_000_000, "هزار": 1_000}
_SHOP = re.compile(r"shop_[0-9a-f]+")
_IN_STOCK = re.compile(r"(?<!نا)موجود(?! نیست)")
_OUT_OF_STOCK = re.compile(r"ناموجود|موجود نیست")


def _prices(text: str) -> set[int]:
    out = set()
    for m in _NUMBER.finditer(normalize(text)):
        if m[2]:
            out.add(round(float(m[1].replace("٫", ".").replace("/", ".")) * _SCALE[m[2]]))
        else:
            out.add(int(re.sub(r"\D", "", m[0])))
    return {p for p in out if p >= 1000}


def ungrounded(claims: str, sources: list[str]) -> list[str]:
    """The claims in `claims` (agent text) that no source (tool output, the user's own words) backs."""
    source = " ".join(sources)
    known = _prices(source)
    missing = [f"price {p}" for p in sorted(_prices(claims) - known)]
    missing += [f"shop {s}" for s in sorted(set(_SHOP.findall(claims)) - set(_SHOP.findall(source)))]
    text = normalize(claims)
    if _IN_STOCK.search(text) and not re.search(r'"available":\s*"yes"', source):
        missing.append("in stock")
    if _OUT_OF_STOCK.search(text) and not re.search(r'"available":\s*"no"', source):
        missing.append("out of stock")
    return missing
