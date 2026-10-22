"""find_alternatives: where else to ask when an inquiry falls through (PRD F6, F7)."""

import datetime as dt
from typing import Literal

from pydantic import BaseModel

from pasazhgard.brief import Brief, seller_query
from pasazhgard.compare import get_product
from pasazhgard.inquiries import _fa, get_inquiries, outcomes
from pasazhgard.normalize import normalize
from pasazhgard.sellers import CategoryShop, SellerList, SellerRow, find_sellers
from pasazhgard.shops import open_at

Reason = Literal["unavailable", "no_reply", "closed"]


Kind = Literal["same_product", "similar_product", "category_only", "fast_delivery"]


class Alternative(BaseModel):
    kind: Kind
    # None for a shop that does not list the product: the inquiry asks it anyway
    offer_id: str | None
    product_id: str
    product_title: str
    shop_id: str
    shop_name: str
    pasaj: str | None
    # the seller's confirmed price, else the listed one
    price_toman: int | None
    # against the price of the inquiry that fell through; None when either is unknown
    price_delta_toman: int | None
    same_pasaj: bool
    open_now: bool | None
    # from the shop that fell through, else from the brief's origin
    distance_m: int | None
    # one line built from the fields above
    tradeoff: str


class Alternatives(BaseModel):
    """The `alternatives` block: the top 2 places to ask instead, in PRD F6 order."""

    inquiry_id: int
    reason: Reason
    alternatives: list[Alternative]


def _toman(n: int) -> str:
    if n < 1_000_000:
        return f"{_fa(str(round(n / 1000)))} هزار تومان"
    return f"{_fa(f'{n / 1_000_000:.1f}'.removesuffix('.0')).replace('.', '٫')} میلیون تومان"


def _tradeoff(a: Alternative) -> str:
    parts = {"similar_product": ["کالای مشابه"], "category_only": ["این کالا را ثبت نکرده، بپرسید"]}.get(a.kind, [])
    if (d := a.price_delta_toman) is not None:
        parts.append("هم‌قیمت" if d == 0 else f"{_toman(abs(d))} {'گران‌تر' if d > 0 else 'ارزان‌تر'}")
    if a.same_pasaj:
        parts.append("همین پاساژ")
    elif a.distance_m is not None:
        parts.append(f"{_fa(str(a.distance_m))} متر فاصله" if a.distance_m < 1000 else f"{_fa(f'{a.distance_m / 1000:.1f}').replace('.', '٫')} کیلومتر فاصله")
    if a.open_now is not None:
        parts.append("الان باز است" if a.open_now else "الان بسته است")
    if a.kind == "fast_delivery":
        parts.append("ارسال سریع دارد")
    return "، ".join(parts)


def find_alternatives(conn, sid: str, inquiry_id: int, now: dt.datetime) -> Alternatives | None:
    """None when the session has no such inquiry; ValueError when the inquiry has not fallen through.

    Order (F6): the same product at another open shop near the plan, same pasaj first; a similar product (same
    category, a spec in common, within budget) nearby; shops of the category that do not list it, to ask; shops
    that deliver fast. Shops already asked about the item are left out, and so are shops closed now, except
    fast-delivery ones.
    """
    status = get_inquiries(conn, sid, now)
    inquiry = next((i for i in status.inquiries if i.inquiry_id == inquiry_id), None) if status else None
    if inquiry is None:
        return None
    if inquiry.status not in Reason.__args__:
        raise ValueError(inquiry.status)
    brief = Brief.model_validate(conn.execute("SELECT brief FROM sessions WHERE session_id = %s", [sid]).fetchone()["brief"])
    # the shop may be gone after a re-ingest; the inquiry outlives it
    failed = conn.execute(
        "SELECT s.lat, s.lon, s.pasaj, o.price_toman FROM shops s LEFT JOIN offers o ON o.offer_id = %s WHERE s.shop_id = %s",
        [inquiry.offer_id, inquiry.shop_id],
    ).fetchone() or {"lat": None, "lon": None, "pasaj": None, "price_toman": None}
    reference_price = inquiry.reply.latest_price_toman or failed["price_toman"]
    origin = (failed["lat"], failed["lon"]) if failed["lat"] is not None else brief.origin and (brief.origin.lat, brief.origin.lon)
    # near the plan, not inside the brief's area: the area is where the first pick was made
    q = seller_query(brief, inquiry.product_id, now).model_copy(
        update={"lat": origin and origin[0], "lon": origin and origin[1], "radius_m": None, "area": None, "pasaj": None, "session_id": sid}
    )
    asked = outcomes(conn, sid, inquiry.product_id, now)
    sellers = find_sellers(conn, inquiry.product_id, q, now)
    if sellers is None:
        return Alternatives(inquiry_id=inquiry_id, reason=inquiry.status, alternatives=[])

    def make(kind: Kind, product_id: str, title: str, shop: SellerRow | CategoryShop, open_now: bool | None) -> Alternative:
        price = shop.latest_price.price_toman or shop.price_toman if isinstance(shop, SellerRow) else None
        a = Alternative(
            kind=kind,
            offer_id=shop.offer_id if isinstance(shop, SellerRow) else None,
            product_id=product_id,
            product_title=title,
            shop_id=shop.shop_id,
            shop_name=shop.shop_name,
            pasaj=shop.pasaj,
            price_toman=price,
            price_delta_toman=price - reference_price if price is not None and reference_price is not None else None,
            same_pasaj=failed["pasaj"] is not None and shop.pasaj == failed["pasaj"],
            open_now=open_now,
            distance_m=shop.distance_m,
            tradeoff="",
        )
        a.tradeoff = _tradeoff(a)
        return a

    def offers(kind: Kind, result: SellerList, rows: list[SellerRow]) -> list[Alternative]:
        return [make(kind, result.product_id, result.title, r, r.open_now) for r in rows if r.shop_id not in asked]

    def near(a: Alternative):
        return (not a.same_pasaj, a.open_now is not True, a.distance_m is None, a.distance_m or 0)

    def same_product():
        return sorted((a for a in offers("same_product", sellers, sellers.sellers + sellers.ask_them) if a.open_now is not False), key=near)

    def similar_product():
        product = get_product(conn, inquiry.product_id)
        if product.category is None:
            return []
        # colour says nothing about fit
        mine = {(s.key, normalize(s.value)) for s in product.specs if "رنگ" not in s.key}
        rows = conn.execute(
            "SELECT product_id, specs FROM products WHERE category = %s AND product_id <> %s", [product.category, product.product_id]
        ).fetchall()
        ranked = sorted(((len(mine & {(s["key"], normalize(s["value"])) for s in p["specs"]}), p["product_id"]) for p in rows), key=lambda r: -r[0])
        found = []
        # shortcut: sellers of only the 5 products sharing the most specs are looked up; weigh specs if suggestions look far off
        for shared, product_id in [r for r in ranked if r[0]][:5]:
            result = find_sellers(conn, product_id, q, now)
            found += [(shared, a) for a in offers("similar_product", result, result.sellers + result.ask_them) if a.open_now is not False]
        return [a for _, a in sorted(found, key=lambda x: (-x[0], near(x[1])))]

    def category_only():
        shops = [c for c in sellers.category_only if c.shop_id not in asked]
        hours = {r["shop_id"]: r["hours"] for r in conn.execute("SELECT shop_id, hours FROM shops WHERE shop_id = ANY(%s)", [[c.shop_id for c in shops]])}
        found = [make("category_only", sellers.product_id, sellers.title, c, open_at(hours[c.shop_id], now)) for c in shops]
        return sorted((a for a in found if a.open_now is not False), key=near)

    def fast_delivery():
        result = find_sellers(conn, inquiry.product_id, q.model_copy(update={"fast_delivery": True}), now)
        return sorted(offers("fast_delivery", result, result.sellers), key=near)

    picked = []
    for tier in (same_product, similar_product, category_only, fast_delivery):
        for a in tier():
            if len(picked) < 2 and a.shop_id not in {p.shop_id for p in picked}:
                picked.append(a)
        if len(picked) == 2:
            break
    return Alternatives(inquiry_id=inquiry_id, reason=inquiry.status, alternatives=picked)
