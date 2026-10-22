"""get_product and compare_products: full product details and a side-by-side compare."""

from datetime import datetime
from typing import Annotated, Literal

from pydantic import AfterValidator, BaseModel, Field

from pasazhgard.normalize import distinct, normalize
from pasazhgard.search import PriceRange, Spec, _price_range
from pasazhgard.sellers import SellerQuery, _distance, _in_area


class Product(BaseModel):
    product_id: str
    title: str
    brand: str | None
    category: str | None
    image_urls: list[str]
    specs: list[Spec]


def get_product(conn, product_id: str) -> Product | None:
    row = conn.execute(
        "SELECT product_id, title, brand, category, image_urls, specs FROM products WHERE product_id = %s", [product_id]
    ).fetchone()
    return row and Product(**row)


class ProductCompareQuery(SellerQuery):
    """2-3 distinct products. Only the area applies, as in compare_products."""

    ids: Annotated[list[str], Field(min_length=2, max_length=3), AfterValidator(distinct)]


class SpecRow(BaseModel):
    """One spec across the compared products; a value is None where a product does not record it."""

    key: str
    values: list[str | None]
    differs: bool


class WarrantySummary(BaseModel):
    """Warranties nearby sellers listed. `unknown` when none of them records a warranty value."""

    trust_level: Literal["listed", "unknown"]
    # sellers whose warranty has a term; one without a term is often noise ("تایید اصالت")
    sellers: int
    max_months: int | None


class Column(BaseModel):
    product_id: str
    title: str
    brand: str | None
    image_url: str | None
    # nearby: shops in the brief's area that list the product
    price: PriceRange
    seller_count: int
    warranty: WarrantySummary


class ProductCompare(BaseModel):
    products: list[Column]
    specs: list[SpecRow]


def _column(p: Product, offers: list[dict], now: datetime) -> Column:
    months = {o["shop_id"]: o["warranty"]["months"] for o in offers if o["warranty"] and o["warranty"]["months"]}
    return Column(
        product_id=p.product_id,
        title=p.title,
        brand=p.brand,
        image_url=next(iter(p.image_urls), None),
        price=_price_range(offers, now),
        seller_count=len({o["shop_id"] for o in offers}),
        warranty=WarrantySummary(
            trust_level="listed" if any(o["warranty"] for o in offers) else "unknown",
            sellers=len(months),
            max_months=max(months.values(), default=None),
        ),
    )


def compare_products(conn, product_ids: list[str], q: SellerQuery, now: datetime) -> ProductCompare | None:
    """None when a product is unknown. Only the area of `q` applies: nearby means in the area."""
    products = [get_product(conn, pid) for pid in product_ids]
    if None in products:
        return None
    nearby = {pid: [] for pid in product_ids}
    for o in conn.execute(
        """
        SELECT o.product_id, o.shop_id, o.price_toman, o.last_price_changed_at, o.price_flags, o.warranty,
               s.location_label, s.pasaj, s.lat, s.lon
        FROM offers o JOIN shops s USING (shop_id)
        WHERE o.product_id = ANY(%s)
        """,
        [product_ids],
    ):
        if _in_area(q, o, _distance(q, o)):
            nearby[o["product_id"]].append(o)
    # a product's first row wins when it repeats a key
    by_key = [{} for _ in products]
    for own, p in zip(by_key, products):
        for s in p.specs:
            own.setdefault(s.key, s.value)
    keys = dict.fromkeys(k for own in by_key for k in own)
    specs = []
    for k in keys:
        values = [own.get(k) for own in by_key]
        specs.append(SpecRow(key=k, values=values, differs=len({v and normalize(v) for v in values}) > 1))
    return ProductCompare(
        products=[_column(p, nearby[p.product_id], now) for p in products],
        specs=specs,
    )
