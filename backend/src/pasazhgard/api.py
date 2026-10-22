import hmac
import logging
import os
import time
from collections.abc import AsyncIterable, Callable
from contextlib import asynccontextmanager
from datetime import datetime, timedelta
from functools import cache
from typing import Annotated

import anyio
import psycopg
from ag_ui_langgraph import LangGraphAgent, add_langgraph_fastapi_endpoint
from fastapi import Depends, FastAPI, HTTPException, Query, Response
from fastapi.exceptions import RequestValidationError
from fastapi.sse import EventSourceResponse
from langchain_core.language_models import BaseChatModel
from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver
from psycopg.rows import dict_row
from psycopg_pool import AsyncConnectionPool
from pydantic import BaseModel, ValidationError

from pasazhgard.agent import Ports, build_graph, chat_model_from_env
from pasazhgard.alternatives import Alternatives, find_alternatives
from pasazhgard.brief import Session, SessionPatch, create_session, get_session, patch_session
from pasazhgard.compare import Product, ProductCompare, ProductCompareQuery, compare_products, get_product
from pasazhgard.discovery import Shortlist, SuggestQuery, suggest_models
from pasazhgard.embeddings import Embedder, embedder_from_env
from pasazhgard.inquiries import (
    Compose,
    Confirm,
    ConsoleInbox,
    ConsoleReply,
    Inquiry,
    InquiryStatus,
    SellerChannel,
    SellerConsole,
    confirm_inquiries,
    console_inbox,
    console_token,
    contact_seller,
    get_inquiries,
    record_reply,
)
from pasazhgard.pasaj import PasajView, brief_products, pasaj_view
from pasazhgard.responder import Responder, respond, responder_from_env
from pasazhgard.routing import Router, router_from_env
from pasazhgard.search import SearchResult, search_products
from pasazhgard.seller_compare import CompareQuery, SellerCompare, compare_sellers
from pasazhgard.sellers import SellerList, SellerQuery, find_sellers
from pasazhgard.shops import TEHRAN, ShopDetails, shop_details
from pasazhgard.visit import Directions, DirectionsQuery, PlanQuery, VisitPlan, get_directions, plan_visit


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Serves the agent graph at /agent with its Postgres checkpointer (ADR-0002)."""
    kwargs = {"autocommit": True, "prepare_threshold": 0, "row_factory": dict_row}
    async with AsyncConnectionPool(os.environ["DATABASE_URL"], kwargs=kwargs, max_size=5, open=False) as pool:
        checkpointer = AsyncPostgresSaver(pool)
        await checkpointer.setup()
        ports = Ports(
            model=lambda: _resolve(get_chat_model),
            now=lambda: _resolve(get_now),
            embedder=lambda: _resolve(get_embedder),
            router=lambda: _resolve(get_router),
            connect=lambda: _connect(row_factory=dict_row),
        )
        graph = build_graph(ports).compile(checkpointer=checkpointer)
        add_langgraph_fastapi_endpoint(app, LangGraphAgent(name="pasazhgard", graph=graph, emit_raw_events=False), "/agent")
        async with anyio.create_task_group() as tg:
            if responder := responder_from_env():
                tg.start_soon(_auto_respond, responder)
            yield
            tg.cancel_scope.cancel()


async def _auto_respond(config: Responder) -> None:
    """The auto-responder's loop (#22): every few seconds the waiting Seller Console inquiries get their replies."""
    while True:
        try:
            await anyio.to_thread.run_sync(_respond_once, config)
        except Exception:
            logging.getLogger(__name__).warning("auto-responder pass failed", exc_info=True)
        await anyio.sleep(5)


def _respond_once(config: Responder) -> None:
    with _connect(row_factory=dict_row) as conn:
        respond(conn, config, _resolve(get_now), _resolve(get_chat_model), _resolve(get_small_model))


app = FastAPI(title="Pasazhgard", lifespan=lifespan)


def _resolve(port):
    """A port as the graph sees it: the graph runs outside FastAPI's Depends, but honours its overrides."""
    return app.dependency_overrides.get(port, port)()


def _connect(**kwargs) -> psycopg.Connection:
    return psycopg.connect(os.environ["DATABASE_URL"], connect_timeout=3, **kwargs)


def get_conn():
    # shortcut: one connection per request, move to a pool when load needs it
    with _connect(row_factory=dict_row) as conn:
        yield conn


def get_now() -> datetime:
    """The clock port: all open-now and open-at-arrival logic reads it, tests override it."""
    return datetime.now(TEHRAN)


@cache
def get_embedder() -> Embedder | None:
    """The embedding port; None without a key, and search stays lexical."""
    return embedder_from_env()


@cache
def get_chat_model() -> BaseChatModel | None:
    """The chat model port; None without a key, and /agent answers in degraded mode."""
    return chat_model_from_env()


@cache
def get_small_model() -> BaseChatModel | None:
    """The small model port that parses free-text seller replies; None without a key, and they stay unparsed."""
    return chat_model_from_env(small=True)


def get_channel() -> SellerChannel:
    """The seller channel port; the Seller Console is the only adapter."""
    return SellerConsole()


def get_console_secret() -> str | None:
    """Signs the Seller Console links; without it the console is closed."""
    return os.environ.get("CONSOLE_SECRET") or None


def _seller_of(shop_id: str, token: str | None, secret: str | None) -> None:
    if not (secret and token and hmac.compare_digest(token, console_token(secret, shop_id))):
        raise HTTPException(403, "not this shop's console link")


@cache
def get_router() -> Router:
    """The routing port; straight-line estimates without a key."""
    return router_from_env()


@app.get("/health")
def health(response: Response) -> dict:
    # LLM and map keys are optional: without them the app runs in degraded mode
    body = {"llm": bool(os.environ.get("LLM_API_KEY")), "maps": bool(os.environ.get("NESHAN_API_KEY"))}
    try:
        with _connect() as conn:
            conn.execute("SELECT 1")
    except psycopg.Error:
        response.status_code = 503
        return {"status": "error", "db": "unreachable", **body}
    return {"status": "ok", "db": "ok", **body}


@app.get("/products/search")
def products_search(
    q: str = Query(min_length=1, max_length=200),
    limit: int = Query(20, ge=1, le=50),
    conn=Depends(get_conn),
    now: datetime = Depends(get_now),
    embedder: Embedder | None = Depends(get_embedder),
) -> SearchResult:
    return search_products(conn, q, now, limit, embedder)


# before /products/{product_id}, which would take "suggest" as an id
@app.get("/products/suggest")
def products_suggest(
    q: Annotated[SuggestQuery, Query()],
    conn=Depends(get_conn),
    now: datetime = Depends(get_now),
    embedder: Embedder | None = Depends(get_embedder),
) -> Shortlist:
    return suggest_models(conn, q, now, embedder)


# before /products/{product_id}, which would take "compare" as an id
@app.get("/products/compare")
def products_compare(
    q: Annotated[ProductCompareQuery, Query()], conn=Depends(get_conn), now: datetime = Depends(get_now)
) -> ProductCompare:
    result = compare_products(conn, q.ids, q, now)
    if result is None:
        raise HTTPException(404, "product not found")
    return result


@app.get("/products/{product_id}")
def products_detail(product_id: str, conn=Depends(get_conn)) -> Product:
    product = get_product(conn, product_id)
    if product is None:
        raise HTTPException(404, "product not found")
    return product


@app.get("/products/{product_id}/sellers")
def products_sellers(
    product_id: str,
    q: Annotated[SellerQuery, Query()],
    conn=Depends(get_conn),
    now: datetime = Depends(get_now),
) -> SellerList:
    result = find_sellers(conn, product_id, q, now)
    if result is None:
        raise HTTPException(404, "product not found")
    return result


@app.get("/products/{product_id}/sellers/compare")
def products_sellers_compare(
    product_id: str,
    q: Annotated[CompareQuery, Query()],
    conn=Depends(get_conn),
    now: datetime = Depends(get_now),
) -> SellerCompare:
    result = compare_sellers(conn, product_id, q, now)
    if result is None:
        raise HTTPException(404, "product or offer not found")
    return result


@app.get("/shops/{shop_id}")
def shops_detail(shop_id: str, conn=Depends(get_conn), now: datetime = Depends(get_now)) -> ShopDetails:
    shop = shop_details(conn, shop_id, now)
    if shop is None:
        raise HTTPException(404, "shop not found")
    return shop


@app.get("/pasajs/{pasaj}")
def pasajs_detail(
    pasaj: str,
    product_id: Annotated[list[str], Query()] = [],
    session_id: str | None = None,
    conn=Depends(get_conn),
    now: datetime = Depends(get_now),
) -> PasajView:
    if session_id is not None:
        session = get_session(conn, session_id)
        if session is None:
            raise HTTPException(404, "session not found")
        product_id = [*product_id, *brief_products(session)]
    view = pasaj_view(conn, pasaj, product_id, now)
    if view is None:
        raise HTTPException(404, "pasaj not found")
    return view


@app.get("/shops/{shop_id}/directions")
def shops_directions(
    shop_id: str, q: Annotated[DirectionsQuery, Query()], conn=Depends(get_conn), router: Router = Depends(get_router)
) -> Directions:
    directions = get_directions(conn, shop_id, q, router)
    if directions is None:
        raise HTTPException(404, "shop not found")
    return directions


class _RouteOnce:
    def __init__(self, router: Router):
        self.route = cache(router.route)


def get_plan_router(router: Router = Depends(get_router)) -> Router:
    """The routing port, each leg routed once per request: the plan stream recomputes the plan twice a second."""
    return _RouteOnce(router)


@app.get("/visit-plan")
def visit_plan(
    q: Annotated[PlanQuery, Query()],
    conn=Depends(get_conn),
    now: datetime = Depends(get_now),
    router: Router = Depends(get_plan_router),
) -> VisitPlan:
    plan = plan_visit(conn, q, now, router)
    if plan is None:
        raise HTTPException(404, "shop or session not found")
    return plan


@app.post("/sessions", status_code=201)
def sessions_create(conn=Depends(get_conn)) -> Session:
    return get_session(conn, create_session(conn))


@app.get("/sessions/{session_id}")
def sessions_read(session_id: str, conn=Depends(get_conn)) -> Session:
    session = get_session(conn, session_id)
    if session is None:
        raise HTTPException(404, "session not found")
    return session


@app.patch("/sessions/{session_id}")
def sessions_patch(
    session_id: str,
    change: SessionPatch,
    conn=Depends(get_conn),
    now: datetime = Depends(get_now),
    embedder: Embedder | None = Depends(get_embedder),
) -> Session:
    try:
        session = patch_session(conn, session_id, change, now, embedder)
    except ValidationError as e:
        raise RequestValidationError(e.errors(include_url=False, include_context=False)) from None
    except LookupError:
        raise HTTPException(404, "product not found") from None
    if session is None:
        raise HTTPException(404, "session not found")
    return session


@app.post("/sessions/{session_id}/inquiries", status_code=201)
def inquiries_compose(session_id: str, change: Compose, conn=Depends(get_conn), now: datetime = Depends(get_now)) -> InquiryStatus:
    try:
        drafts = contact_seller(conn, session_id, change, now)
    except LookupError:
        raise HTTPException(404, "offer not found") from None
    except ValueError:
        raise HTTPException(409, "at most 3 open inquiries per item") from None
    if drafts is None:
        raise HTTPException(404, "session not found")
    return drafts


@app.post("/sessions/{session_id}/inquiries/confirm")
def inquiries_confirm(
    session_id: str,
    change: Confirm,
    conn=Depends(get_conn),
    now: datetime = Depends(get_now),
    channel: SellerChannel = Depends(get_channel),
) -> InquiryStatus:
    try:
        status = confirm_inquiries(conn, session_id, change, channel, now)
    except LookupError:
        raise HTTPException(404, "inquiry not found") from None
    except ValueError:
        raise HTTPException(409, "at most 3 open inquiries per item") from None
    if status is None:
        raise HTTPException(404, "session not found")
    return status


@app.get("/sessions/{session_id}/inquiries")
def inquiries_read(session_id: str, conn=Depends(get_conn), now: datetime = Depends(get_now)) -> InquiryStatus:
    status = get_inquiries(conn, session_id, now)
    if status is None:
        raise HTTPException(404, "session not found")
    return status


@app.get("/sessions/{session_id}/inquiries/{inquiry_id}/alternatives")
def inquiries_alternatives(session_id: str, inquiry_id: int, conn=Depends(get_conn), now: datetime = Depends(get_now)) -> Alternatives:
    try:
        block = find_alternatives(conn, session_id, inquiry_id, now)
    except ValueError:
        raise HTTPException(409, "inquiry has not fallen through") from None
    if block is None:
        raise HTTPException(404, "inquiry not found")
    return block


@app.get("/console/shops/{shop_id}/inquiries")
def console_read(
    shop_id: str,
    token: str | None = None,
    conn=Depends(get_conn),
    now: datetime = Depends(get_now),
    secret: str | None = Depends(get_console_secret),
) -> ConsoleInbox:
    _seller_of(shop_id, token, secret)
    inbox = console_inbox(conn, shop_id, now)
    if inbox is None:
        raise HTTPException(404, "shop not found")
    return inbox


@app.post("/console/inquiries/{inquiry_id}/replies")
def console_reply(
    inquiry_id: int,
    body: ConsoleReply,
    token: str | None = None,
    conn=Depends(get_conn),
    now: datetime = Depends(get_now),
    model: BaseChatModel | None = Depends(get_small_model),
    secret: str | None = Depends(get_console_secret),
) -> Inquiry:
    row = conn.execute("SELECT shop_id FROM inquiries WHERE inquiry_id = %s", [inquiry_id]).fetchone()
    _seller_of(row["shop_id"] if row else "", token, secret)
    try:
        return record_reply(conn, inquiry_id, body, now, model)
    except LookupError:
        raise HTTPException(404, "inquiry not found") from None
    except ValueError:
        raise HTTPException(409, "inquiry not sent") from None


async def _changes[T: BaseModel](load: Callable[[psycopg.Connection, datetime], T], now: datetime) -> AsyncIterable[T]:
    """`load(conn, at)` now and again each time its result changes; `at` is the request's clock, running on."""
    last, start = None, time.monotonic()
    # shortcut: polls the store twice a second; move to LISTEN/NOTIFY if many trackers stay open
    with _connect(row_factory=dict_row, autocommit=True) as conn:
        while True:
            current = await anyio.to_thread.run_sync(load, conn, now + timedelta(seconds=time.monotonic() - start))
            if current != last:
                yield current
                last = current
            await anyio.sleep(0.5)


def _no_transform(response: Response) -> None:
    # the Next.js proxy gzips, and so buffers, any response whose Cache-Control lacks no-transform
    response.headers["Cache-Control"] = "no-cache, no-transform"


@app.get("/sessions/{session_id}/inquiries/stream", response_class=EventSourceResponse, dependencies=[Depends(_no_transform)])
async def inquiries_stream(
    session_id: str, _=Depends(inquiries_read), now: datetime = Depends(get_now)
) -> AsyncIterable[InquiryStatus]:
    async for status in _changes(lambda conn, at: get_inquiries(conn, session_id, at), now):
        yield status


class PlanStreamQuery(PlanQuery):
    # without a session the plan never changes
    session_id: str


def _plan_found(q: Annotated[PlanStreamQuery, Query()], now: datetime = Depends(get_now), router: Router = Depends(get_plan_router)) -> None:
    # its own connection, closed before the stream opens the one it polls on
    with _connect(row_factory=dict_row) as conn:
        visit_plan(q, conn, now, router)


@app.get("/visit-plan/stream", response_class=EventSourceResponse, dependencies=[Depends(_no_transform), Depends(_plan_found)])
async def visit_plan_stream(
    q: Annotated[PlanStreamQuery, Query()],
    now: datetime = Depends(get_now),
    router: Router = Depends(get_plan_router),
) -> AsyncIterable[VisitPlan]:
    # the trip leaves when the stream opens, so only the session's inquiries change the plan
    fixed = q.model_copy(update={"depart_at": q.depart_at or now})
    async for plan in _changes(lambda conn, at: plan_visit(conn, fixed, at, router), now):
        yield plan


@app.get("/console/shops/{shop_id}/inquiries/stream", response_class=EventSourceResponse, dependencies=[Depends(_no_transform)])
async def console_stream(shop_id: str, _=Depends(console_read), now: datetime = Depends(get_now)) -> AsyncIterable[ConsoleInbox]:
    async for inbox in _changes(lambda conn, at: console_inbox(conn, shop_id, at), now):
        yield inbox
