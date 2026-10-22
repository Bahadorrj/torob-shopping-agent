"""optimize_basket: the fewest shops that cover a pasted list, then the lowest total."""

import re
from datetime import datetime
from itertools import combinations
from typing import Literal

from pydantic import BaseModel, Field

from pasazhgard.normalize import normalize
from pasazhgard.search import search_products
from pasazhgard.sellers import SellerQuery, _distance, _in_area, find_sellers

# a coil of wire, in meters
COIL_M = 100
_UNITS = {"عدد": ("piece", 1), "تا": ("piece", 1), "دانه": ("piece", 1), "متر": ("meter", 1), "حلقه": ("meter", COIL_M), "کلاف": ("meter", COIL_M)}


class BasketQuery(SellerQuery):
    text: str = Field(min_length=1, max_length=2000)


class BasketItem(BaseModel):
    """A list line resolved to a product, else to the category of its nearest product; neither when nothing is close."""

    line: str
    product_id: str | None
    title: str | None
    category: str | None
    quantity: int
    unit: Literal["piece", "meter"]


class StopItem(BaseModel):
    # index into `Basket.items`
    item: int
    offer_id: str | None
    price_toman: int | None
    per_meter: bool
    # price times quantity; None when the price or the unit does not allow it
    total_toman: int | None
    trust_level: Literal["listed", "unknown", "category_only"]


class BasketStop(BaseModel):
    shop_id: str
    shop_name: str
    address: str | None
    pasaj: str | None
    floor: str | None
    unit: str | None
    items: list[StopItem]
    total_toman: int


class Basket(BaseModel):
    items: list[BasketItem]
    stops: list[BasketStop]
    # indexes into `items` no shop in the area covers
    missing: list[int]
    # priced items only: category-only and unpriced ones are left out
    total_toman: int


def parse_lines(text: str) -> list[tuple[str, str, int, str]]:
    """Each line as (line, search words, quantity, unit); commas separate items as newlines do."""
    # only a number with a unit word is a quantity: in "کلید مینیاتوری ۱۶" the 16 is amperes
    quantity_re = re.compile(rf"(\d+(?:\.\d+)?)\s*({'|'.join(_UNITS)})(?!\w)")
    out = []
    for line in (p.strip() for p in re.split(r"[\n\r،,;]+", text)):
        if not line:
            continue
        words, quantity, unit = normalize(line), 1, "piece"
        if m := quantity_re.search(words):
            unit, per = _UNITS[m[2]]
            quantity = max(1, round(float(m[1]) * per))
            words = (words[: m.start()] + words[m.end() :]).strip()
        out.append((line, words, quantity, unit))
    return out


def _resolve(conn, line: str, words: str, quantity: int, unit: str, now: datetime) -> BasketItem:
    found = search_products(conn, words, now).items
    # a product only when it has every word of the line; otherwise the line names a kind of thing, and the
    # first word is its head noun ("محافظ برق ۱۶ آمپر" is a محافظ, not a برق cable)
    exact = next((p for p in found if all(w.matched for w in p.score_parts)), None)
    kind = exact or next((p for p in found if p.score_parts and p.score_parts[0].matched), None)
    return BasketItem(
        line=line,
        product_id=exact and exact.product_id,
        title=exact and exact.title,
        category=kind and kind.category,
        quantity=quantity,
        unit=unit,
    )


def _line_total(price: int | None, per_meter: bool, item: BasketItem) -> int | None:
    # a meter quantity of a piece-priced offer (a whole coil) has no known piece count
    if price is None or (item.unit == "meter" and not per_meter):
        return None
    return price * item.quantity


def optimize_basket(conn, q: BasketQuery, now: datetime) -> Basket:
    items = [_resolve(conn, *line, now) for line in parse_lines(q.text)]
    # shop -> item index -> what the shop offers for it
    offers: dict[str, dict[int, StopItem]] = {}
    for i, item in enumerate(items):
        if item.product_id:
            found = find_sellers(conn, item.product_id, q.model_copy(update={"quantity": item.quantity}), now)
            for r in found.sellers + found.ask_them:
                price = r.latest_price.price_toman or r.price_toman
                offers.setdefault(r.shop_id, {})[i] = StopItem(
                    item=i, offer_id=r.offer_id, price_toman=price, per_meter=r.per_meter,
                    total_toman=_line_total(price, r.per_meter, item), trust_level=r.trust_level,
                )
        elif item.category:
            for s in conn.execute("SELECT shop_id, location_label, pasaj, lat, lon FROM shops WHERE %s = ANY(categories)", [item.category]):
                if _in_area(q, s, _distance(q, s)):
                    offers.setdefault(s["shop_id"], {})[i] = StopItem(
                        item=i, offer_id=None, price_toman=None, per_meter=False, total_toman=None, trust_level="category_only"
                    )
    coverable = set().union(*(o.keys() for o in offers.values()))

    def cost(items: list[StopItem]) -> tuple[int, int]:
        """Priced before unpriced, then cheapest."""
        return (sum(s.total_toman is None for s in items), sum(s.total_toman or 0 for s in items))

    # shops covering the same items compete; the 3 cheapest of each kind keep the exhaustive search small
    by_cover: dict[frozenset, list[str]] = {}
    for shop_id in sorted(offers, key=lambda s: (cost(list(offers[s].values())), s)):
        by_cover.setdefault(frozenset(offers[shop_id]), []).append(shop_id)
    candidates = [s for shops in by_cover.values() for s in shops[:3]]

    def assign(shops: tuple[str, ...]) -> dict[int, tuple[str, StopItem]]:
        """Each item at the chosen shop where it costs least, priced before unpriced."""
        picks = {}
        for s in shops:
            for i, o in offers[s].items():
                if i not in picks or cost([o]) < cost([picks[i][1]]):
                    picks[i] = (s, o)
        return picks

    best = None
    for k in range(1, len(coverable) + 1):
        for shops in combinations(sorted(candidates), k):
            picks = assign(shops)
            if picks.keys() != coverable:
                continue
            key = (cost([o for _, o in picks.values()]), shops)
            if best is None or key < best[0]:
                best = (key, picks)
        if best:
            break
    picks = best[1] if best else {}
    used = list(dict.fromkeys(s for s, _ in sorted(picks.values(), key=lambda p: p[1].item)))
    info = {r["shop_id"]: r for r in conn.execute("SELECT shop_id, name, address, pasaj, floor, unit FROM shops WHERE shop_id = ANY(%s)", [used])}
    stops = []
    for s in used:
        mine = sorted((o for shop, o in picks.values() if shop == s), key=lambda o: o.item)
        shop = info[s]
        stops.append(
            BasketStop(
                shop_id=s, shop_name=shop["name"], address=shop["address"], pasaj=shop["pasaj"], floor=shop["floor"], unit=shop["unit"],
                items=mine, total_toman=sum(o.total_toman or 0 for o in mine),
            )
        )
    return Basket(
        items=items,
        stops=stops,
        missing=[i for i in range(len(items)) if i not in coverable],
        total_toman=sum(st.total_toman for st in stops),
    )
