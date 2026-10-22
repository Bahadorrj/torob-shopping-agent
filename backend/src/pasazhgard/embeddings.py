"""The embedding provider port. Without LLM_API_KEY there is no provider and search stays lexical."""

import json
import os
import urllib.request
from typing import Protocol


class Embedder(Protocol):
    # identifies the vector space: vectors from different names are not comparable
    name: str
    dimensions: int

    def embed(self, texts: list[str]) -> list[list[float]]: ...


class OpenAIEmbedder:
    """OpenAI-compatible `/embeddings` endpoint (BoxAPI by default, ADR-0001)."""

    def __init__(self, base_url: str, api_key: str, model: str, dimensions: int):
        self.base_url, self.api_key, self.model, self.dimensions = base_url.rstrip("/"), api_key, model, dimensions
        self.name = f"{model}/{dimensions}"

    def embed(self, texts: list[str]) -> list[list[float]]:
        request = urllib.request.Request(
            f"{self.base_url}/embeddings",
            data=json.dumps({"model": self.model, "input": texts, "dimensions": self.dimensions}).encode(),
            headers={"Authorization": f"Bearer {self.api_key}", "Content-Type": "application/json"},
        )
        # a search embeds one query and must fail fast; ingest batches get more time
        with urllib.request.urlopen(request, timeout=5 + len(texts) / 50) as response:
            data = json.load(response)["data"]
        return [d["embedding"] for d in sorted(data, key=lambda d: d["index"])]


def embedder_from_env() -> Embedder | None:
    key = os.environ.get("LLM_API_KEY")
    if not key:
        return None
    return OpenAIEmbedder(
        os.environ.get("LLM_BASE_URL", "https://ai.boxapi.ir/ai/v1"),
        key,
        os.environ.get("EMBEDDING_MODEL", "text-embedding-3-small"),
        int(os.environ.get("EMBEDDING_DIMENSIONS", "512")),
    )
