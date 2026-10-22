"""Shopping Brief (PRD 6.1): one per anonymous session, the single source of truth for the agent and the UI."""

import datetime as dt
import uuid
from typing import Annotated, Literal, Self

from psycopg.types.json import Jsonb
from pydantic import BaseModel, Field, field_validator, model_validator

from pasazhgard.compare import ProductCompare, compare_products
from pasazhgard.embeddings import Embedder
from pasazhgard.search import SearchResult, search_products
from pasazhgard.sellers import SellerList, SellerQuery, area_options, find_sellers
from pasazhgard.shops import TEHRAN


class Item(BaseModel):
    product_id: str | None = None
    category: str | None = None
    quantity: int = Field(1, gt=0)
    unit: Literal["piece", "meter"] = "piece"


class Budget(BaseModel):
    max_total_toman: int | None = Field(None, gt=0)
    max_per_item_toman: int | None = Field(None, gt=0)


class Point(BaseModel):
    lat: float = Field(ge=-90, le=90)
    lon: float = Field(ge=-180, le=180)


class Area(BaseModel):
    """One of: a radius around the origin, a named area, a pasaj."""

    radius_m: int | None = Field(None, gt=0, le=50_000)
    name: str | None = None
    pasaj: str | None = None

    @model_validator(mode="after")
    def _one(self) -> Self:
        if sum(x is not None for x in (self.radius_m, self.name, self.pasaj)) != 1:
            raise ValueError("pick one of radius_m, name, pasaj")
        return self


class VisitWindow(BaseModel):
    date: dt.date | None = None
    earliest_arrival: dt.time | None = None
    latest_departure: dt.time | None = None


class Payment(BaseModel):
    kind: Literal["any", "cash", "torob_pay", "installment"] = "any"
    provider: str | None = None


class MustHave(BaseModel):
    warranty: bool = False
    test_in_presence: bool = False
    fast_delivery: bool = False


class Brief(BaseModel):
    need: str | None = None
    items: list[Item] = []
    budget: Budget = Budget()
    origin: Point | None = None
    area: Area | None = None
    visit_window: VisitWindow = VisitWindow()
    travel_mode: Literal["walk", "transit", "car"] | None = None
    payment: Payment = Payment()
    must_have: MustHave = MustHave()
    priority: Literal["cheapest", "closest", "most_reliable"] = "cheapest"
    # filled by the visit planner and the Seller Liaison
    plan: list[dict] = []
    inquiries: list[dict] = []

    @model_validator(mode="after")
    def _radius_needs_origin(self) -> Self:
        if self.area and self.area.radius_m is not None and self.origin is None:
            raise ValueError("a radius area needs an origin")
        return self


class SearchStep(BaseModel):
    """Product search for `brief.need`."""

    kind: Literal["search"] = "search"


class SellersStep(BaseModel):
    kind: Literal["sellers"] = "sellers"
    product_id: str
    # set by the server from the product, for the recent-sessions list
    title: str | None = None


class CompareStep(BaseModel):
    kind: Literal["compare"] = "compare"
    product_ids: list[str] = Field(min_length=2, max_length=3)

    @field_validator("product_ids")
    @classmethod
    def _distinct(cls, ids: list[str]) -> list[str]:
        if len(set(ids)) != len(ids):
            raise ValueError("a product is listed twice")
        return ids


Step = Annotated[SearchStep | SellersStep | CompareStep, Field(discriminator="kind")]


class Center(BaseModel):
    """A covered area or pasaj as a radius origin: the mean position of its shops."""

    kind: Literal["area", "pasaj"]
    name: str
    lat: float
    lon: float


class Session(BaseModel):
    session_id: str
    brief: Brief
    step: Step | None
    # area chip options: every covered area and pasaj
    areas: list[str]
    pasajs: list[str]
    # radius origins picked without a map, beside geolocation
    centers: list[Center]
    # the current step re-run against the brief; only on patch
    results: SellerList | SearchResult | ProductCompare | None = None


def create_session(conn) -> str:
    sid = uuid.uuid4().hex
    conn.execute("INSERT INTO sessions (session_id, brief) VALUES (%s, %s)", [sid, Jsonb(Brief().model_dump(mode="json"))])
    return sid


def get_session(conn, sid: str) -> Session | None:
    row = conn.execute("SELECT brief, step FROM sessions WHERE session_id = %s", [sid]).fetchone()
    if row is None:
        return None
    centers = conn.execute(
        """
        SELECT 'area' AS kind, location_label AS name, avg(lat) AS lat, avg(lon) AS lon FROM shops
        WHERE location_label IS NOT NULL AND lat IS NOT NULL GROUP BY location_label
        UNION ALL
        SELECT 'pasaj', pasaj, avg(lat), avg(lon) FROM shops WHERE pasaj IS NOT NULL AND lat IS NOT NULL GROUP BY pasaj
        ORDER BY kind, name
        """
    ).fetchall()
    return Session(session_id=sid, brief=row["brief"], step=row["step"], centers=centers, **area_options(conn))


class SessionPatch(BaseModel):
    """`brief` replaces the top-level brief fields it names; `step` moves the session to another step."""

    brief: dict = {}
    step: Step | None = None

    @field_validator("brief")
    @classmethod
    def _patchable(cls, brief: dict) -> dict:
        # plan and inquiries are written by the planner and the Seller Liaison, not by the client
        if bad := set(brief) - (set(Brief.model_fields) - {"plan", "inquiries"}):
            raise ValueError(f"not patchable: {', '.join(sorted(bad))}")
        return brief


def seller_query(brief: Brief, product_id: str, now: dt.datetime) -> SellerQuery:
    area, origin, visit = brief.area, brief.origin, brief.visit_window
    quantity = next((i.quantity for i in brief.items if i.product_id == product_id), 1)
    arrival = None
    if visit.earliest_arrival:
        arrival = dt.datetime.combine(visit.date or now.astimezone(TEHRAN).date(), visit.earliest_arrival, TEHRAN)
    return SellerQuery(
        lat=origin and origin.lat,
        lon=origin and origin.lon,
        radius_m=area and area.radius_m,
        area=area and area.name,
        pasaj=area and area.pasaj,
        priority=brief.priority,
        **brief.budget.model_dump(),
        quantity=quantity,
        arrival=arrival,
        payment=brief.payment.kind,
        provider=brief.payment.provider,
        **brief.must_have.model_dump(),
    )


def patch_session(conn, sid: str, change: SessionPatch, now: dt.datetime, embedder: Embedder | None = None) -> Session | None:
    """Apply the change and re-run the current step. No LLM: brief bar edits stay deterministic and fast.

    The search step embeds the need once per need text; chip edits reuse that vector.

    Raises pydantic.ValidationError for an invalid brief and LookupError for an unknown product; nothing is saved then.
    """
    session = get_session(conn, sid)
    if session is None:
        return None
    session.brief = Brief.model_validate({**session.brief.model_dump(), **change.brief})
    if "step" in change.model_fields_set:
        session.step = change.step
    step = session.step
    if isinstance(step, SellersStep):
        session.results = find_sellers(conn, step.product_id, seller_query(session.brief, step.product_id, now), now)
        if session.results is None:
            raise LookupError(step.product_id)
        step.title = session.results.title
    elif isinstance(step, CompareStep):
        session.results = compare_products(conn, step.product_ids, seller_query(session.brief, step.product_ids[0], now), now)
        if session.results is None:
            raise LookupError(step.product_ids)
    elif isinstance(step, SearchStep) and session.brief.need:
        session.results = search_products(conn, session.brief.need, now, embedder=embedder)
    conn.execute(
        "UPDATE sessions SET brief = %s, step = %s, updated_at = now() WHERE session_id = %s",
        [Jsonb(session.brief.model_dump(mode="json")), Jsonb(step.model_dump(mode="json")) if step else None, sid],
    )
    return session
