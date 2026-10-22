"""Grounding check: prices, shops and availability the agent states must come from tool output."""

import json
import re

from pasazhgard.normalize import normalize

# a price: grouped digits, 4+ digits, or a number with a Persian scale word ("۲ میلیون", "۲.۵ میلیون")
_NUMBER = re.compile(r"(\d+(?:[.٫/]\d+)?)\s*(میلیون|هزار)|\d{1,3}(?:[,٬،]\d{3})+|\d{4,}")
_SHOP = re.compile(r"shop_[0-9a-f]+")
_IN_STOCK = re.compile(r"(?<!نا)موجود(?! نیست)")
_OUT_OF_STOCK = re.compile(r"ناموجود|موجود نیست")
_SENTENCE = re.compile(r"[.!?؟\n]+")


def known_shops(conn) -> re.Pattern | None:
    """The data's shop names as one pattern over normalized text, so agent text that names a shop can be checked.

    A shop name absent from the data is not caught: only names of real shops are claims."""
    names = sorted({normalize(r[0]) for r in conn.execute("SELECT name FROM shops")} - {""}, key=len, reverse=True)
    return re.compile(r"(?<!\w)(?:" + "|".join(map(re.escape, names)) + r")(?!\w)") if names else None


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


def _availability(sources: list[str]) -> dict[str, set[str]]:
    """The `available` values tool output gives each shop, by normalized name and by id: a value counts for the
    nearest object above it that names a shop (an inquiry, a plan stop, a seller row)."""
    out: dict[str, set[str]] = {}

    def walk(node, shops):
        if isinstance(node, dict):
            shops = [normalize(v) for k in ("shop_id", "shop_name") if isinstance(v := node.get(k), str)] or shops
            for k, v in node.items():
                if k == "available" and isinstance(v, str):
                    for s in shops:
                        out.setdefault(s, set()).add(v)
                else:
                    walk(v, shops)
        elif isinstance(node, list):
            for v in node:
                walk(v, shops)

    for source in sources:
        try:
            walk(json.loads(source), [])
        except ValueError:
            pass
    return out


def ungrounded(claims: str, sources: list[str], shops: re.Pattern | None = None) -> list[str]:
    """The claims in `claims` (agent text) that no source (tool output, the user's own words) backs.
    `shops`: the data's shop names (`known_shops`); without it only shop ids are checked."""
    source = " ".join(sources)
    known = set().union(*map(_known_prices, sources))
    missing = [f"price {p}" for p in sorted(_prices(claims) - known)]
    missing += [f"shop {s}" for s in sorted(set(_SHOP.findall(claims)) - set(_SHOP.findall(source)))]
    text, said = normalize(claims), normalize(source)
    if shops:
        missing += [f"shop {s}" for s in sorted(set(shops.findall(text)) - set(shops.findall(said)))]
    available = _availability(sources)
    for sentence in _SENTENCE.split(text):
        # stock said of named shops needs each of them to have said so; said of none, any seller will do
        named = _SHOP.findall(sentence) + (shops.findall(sentence) if shops else [])
        for claim, value, label in ((_IN_STOCK, "yes", "in stock"), (_OUT_OF_STOCK, "no", "out of stock")):
            if not claim.search(sentence) or label in missing:
                continue
            if named:
                backed = all(value in available.get(s, ()) for s in named)
            else:
                backed = re.search(rf'"available":\s*"{value}"', source)
            if not backed:
                missing.append(label)
    return missing


def ungrounded_turn(messages: list[dict], shops: re.Pattern | None = None) -> list[str]:
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
    return ungrounded(" ".join(claims), sources, shops)
