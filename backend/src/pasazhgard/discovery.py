"""suggest_models: guided discovery's shortlist of 2-3 models for a need, from products with nearby sellers."""

from datetime import datetime

from pydantic import BaseModel, Field

from pasazhgard.compare import compare_products
from pasazhgard.embeddings import Embedder
from pasazhgard.normalize import normalize
from pasazhgard.search import PriceRange, Spec, _price_range, _usable, search_products
from pasazhgard.sellers import SellerQuery, _distance, _in_area, _over_budget


class SuggestQuery(SellerQuery):
    """The need in search words, with its use and must-have features. Area and budget apply."""

    need: str = Field(min_length=1, max_length=200)


class ModelPick(BaseModel):
    product_id: str
    title: str
    brand: str | None
    category: str | None
    image_url: str | None
    key_specs: list[Spec]
    # nearby: in the area and within the budget
    price: PriceRange
    seller_count: int
    # plain lines from the data: price and seller standing among the picks, spec values that differ
    tradeoffs: list[str]


class Shortlist(BaseModel):
    need: str
    models: list[ModelPick]


def suggest_models(conn, q: SuggestQuery, now: datetime, embedder: Embedder | None = None) -> Shortlist:
    """The best search matches that have a seller nearby, those with several sellers first. Empty when none has."""
    candidates = search_products(conn, q.need, now, limit=10, embedder=embedder).items
    nearby = {c.product_id: [] for c in candidates}
    for o in conn.execute(
        """
        SELECT o.product_id, o.shop_id, o.price_toman, o.last_price_changed_at, o.price_flags,
               s.location_label, s.pasaj, s.lat, s.lon
        FROM offers o JOIN shops s USING (shop_id)
        WHERE o.product_id = ANY(%s)
        """,
        [list(nearby)],
    ):
        price = o["price_toman"] if _usable([o]) else None
        if _in_area(q, o, _distance(q, o)) and not _over_budget(q, price):
            nearby[o["product_id"]].append(o)
    sellers = {pid: len({o["shop_id"] for o in offers}) for pid, offers in nearby.items()}
    # three sellers count as several; within a tier the search order stands
    picks = sorted((c for c in candidates if sellers[c.product_id]), key=lambda c: -min(sellers[c.product_id], 3))[:3]
    prices = {c.product_id: _price_range(nearby[c.product_id], now) for c in picks}
    models = [
        ModelPick(
            **c.model_dump(include={"product_id", "title", "brand", "category", "image_url", "key_specs"}),
            price=prices[c.product_id],
            seller_count=sellers[c.product_id],
            tradeoffs=[],
        )
        for c in picks
    ]
    if len(models) >= 2:
        _add_tradeoffs(conn, models, q, now)
    return Shortlist(need=q.need, models=models)


def _add_tradeoffs(conn, models: list[ModelPick], q: SellerQuery, now: datetime) -> None:
    listed = [m for m in models if m.price.min_toman is not None]
    if len(listed) >= 2:
        min(listed, key=lambda m: m.price.min_toman).tradeoffs.append("ارزان‌ترین گزینه")
        max(listed, key=lambda m: m.price.min_toman).tradeoffs.append("گران‌ترین گزینه")
    most = max(m.seller_count for m in models)
    for m in models:
        if m.seller_count == most and [x.seller_count for x in models].count(most) == 1:
            m.tradeoffs.append("بیشترین فروشنده در این محدوده")
        elif m.seller_count == 1:
            m.tradeoffs.append("فقط یک فروشنده در این محدوده")
    # specs the picks share but differ on; color and the title's own rows say nothing about fit
    skip = ("رنگ", "برند", "مدل", "نام", "سازنده")
    spec_lines = 2
    compared = compare_products(conn, [m.product_id for m in models], q, now)
    # a row counts when two picks record it with different values; one missing value is no trade-off
    rows = [
        r for r in compared.specs
        if len({normalize(v) for v in r.values if v is not None}) >= 2 and not any(w in r.key for w in skip)
    ]
    for i, m in enumerate(models):
        m.tradeoffs += [f"{r.key}: {r.values[i]}" for r in rows if r.values[i] is not None][:spec_lines]
