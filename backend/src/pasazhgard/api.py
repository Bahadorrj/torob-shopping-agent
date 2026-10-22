import os
from contextlib import asynccontextmanager
from datetime import datetime
from functools import cache
from typing import Annotated

import psycopg
from ag_ui_langgraph import LangGraphAgent, add_langgraph_fastapi_endpoint
from fastapi import Depends, FastAPI, HTTPException, Query, Response
from fastapi.exceptions import RequestValidationError
from langchain_core.language_models import BaseChatModel
from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver
from psycopg.rows import dict_row
from psycopg_pool import AsyncConnectionPool
from pydantic import ValidationError

from pasazhgard.agent import Ports, build_graph, chat_model_from_env
from pasazhgard.brief import Session, SessionPatch, create_session, get_session, patch_session
from pasazhgard.compare import Product, ProductCompare, ProductCompareQuery, compare_products, get_product
from pasazhgard.embeddings import Embedder, embedder_from_env
from pasazhgard.search import SearchResult, search_products
from pasazhgard.seller_compare import CompareQuery, SellerCompare, compare_sellers
from pasazhgard.sellers import SellerList, SellerQuery, find_sellers
from pasazhgard.shops import TEHRAN, ShopDetails, shop_details


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
            connect=lambda: _connect(row_factory=dict_row),
        )
        graph = build_graph(ports).compile(checkpointer=checkpointer)
        add_langgraph_fastapi_endpoint(app, LangGraphAgent(name="pasazhgard", graph=graph, emit_raw_events=False), "/agent")
        yield


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
