"""Discovery eval: for vague needs, does the shortlist hold a model of the right category with nearby sellers?
Runs eval/discovery_queries.json through GET /products/suggest (seam 1). Quality check, not a CI gate.

Usage: uv run python eval/discovery.py   (reads DATABASE_URL; hybrid with LLM_API_KEY, lexical without)
"""

import json
from pathlib import Path


def hit_count(client, cases: list[dict]) -> int:
    """Cases whose shortlist holds a model of the expected category; every listed model has a nearby seller."""
    hits = 0
    for case in cases:
        r = client.get("/products/suggest", params={k: v for k, v in case.items() if k not in ("kind", "category")})
        r.raise_for_status()
        models = r.json()["models"]
        hit = any(m["category"] == case["category"] and m["seller_count"] > 0 for m in models)
        hits += hit
        print(f"{'hit ' if hit else 'MISS'}  {case['need']}  ->  {' / '.join(m['title'] for m in models) or '(no models)'}")
    return hits


if __name__ == "__main__":
    import asyncio

    from fastapi.testclient import TestClient

    from pasazhgard.api import app, get_embedder

    cases = json.loads((Path(__file__).parent / "discovery_queries.json").read_text(encoding="utf-8"))
    # the agent's async checkpointer cannot run on Windows' default Proactor loop
    with TestClient(app, backend_options={"loop_factory": asyncio.SelectorEventLoop}) as client:
        hits = hit_count(client, cases)
    print(f"mode: {'hybrid' if get_embedder() else 'lexical'}")
    print(f"shortlist hit rate: {hits}/{len(cases)} ({hits / len(cases):.0%})")
