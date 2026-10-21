import os
from datetime import UTC, datetime

import psycopg
from fastapi import Depends, FastAPI, Query, Response
from psycopg.rows import dict_row

from pasazhgard.search import SearchResult, search_products

app = FastAPI(title="Pasazhgard")


def _connect(**kwargs) -> psycopg.Connection:
    return psycopg.connect(os.environ["DATABASE_URL"], connect_timeout=3, **kwargs)


def get_conn():
    # shortcut: one connection per request, move to a pool when load needs it
    with _connect(row_factory=dict_row) as conn:
        yield conn


def get_now() -> datetime:
    return datetime.now(UTC)


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
) -> SearchResult:
    return search_products(conn, q, now, limit)
