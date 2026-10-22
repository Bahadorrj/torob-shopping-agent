"""Search eval: top-5 hit rate over eval/search_queries.json, run through the HTTP API (seam 1).
Quality check, not a CI gate.

Usage: uv run python eval/search.py   (reads DATABASE_URL; hybrid with LLM_API_KEY, lexical without)
"""

import json
from pathlib import Path


def hit_count(client, cases: list[dict]) -> int:
    """Queries whose top 5 from GET /products/search hold an expected product."""
    hits = 0
    for case in cases:
        r = client.get("/products/search", params={"q": case["query"], "limit": 5})
        r.raise_for_status()
        top = r.json()["items"]
        hit = any(card["product_id"] in case["expected"] for card in top)
        hits += hit
        print(f"{'hit ' if hit else 'MISS'}  {case['query']}  ->  {top[0]['title'] if top else '(no results)'}")
    return hits


if __name__ == "__main__":
    import asyncio

    from fastapi.testclient import TestClient

    from pasazhgard.api import app, get_embedder

    cases = json.loads((Path(__file__).parent / "search_queries.json").read_text(encoding="utf-8"))
    # the agent's async checkpointer cannot run on Windows' default Proactor loop
    with TestClient(app, backend_options={"loop_factory": asyncio.SelectorEventLoop}) as client:
        hits = hit_count(client, cases)
    print(f"mode: {'hybrid' if get_embedder() else 'lexical'}")
    print(f"top-5 hit rate: {hits}/{len(cases)} ({hits / len(cases):.0%})")
