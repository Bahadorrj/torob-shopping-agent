"""The embedding provider port. Without LLM_API_KEY there is no provider and search stays lexical."""

import os
from typing import Protocol

from langchain_openai import OpenAIEmbeddings


class Embedder(Protocol):
    # identifies the vector space: vectors from different names are not comparable
    name: str
    dimensions: int

    def embed(self, texts: list[str]) -> list[list[float]]: ...


class OpenAIEmbedder:
    """OpenAI-compatible `/embeddings` endpoint through LangChain (BoxAPI by default, ADR-0001, ADR-0002)."""

    def __init__(self, base_url: str, api_key: str, model: str, dimensions: int, timeout: float, max_retries: int):
        self.dimensions = dimensions
        self.name = f"{model}/{dimensions}"
        self._client = OpenAIEmbeddings(
            base_url=base_url,
            api_key=api_key,
            model=model,
            dimensions=dimensions,
            # send raw text: the gateway is not OpenAI, and tiktoken fetches its encodings at runtime
            check_embedding_ctx_length=False,
            timeout=timeout,
            max_retries=max_retries,
        )

    def embed(self, texts: list[str]) -> list[list[float]]:
        return self._client.embed_documents(texts)


def embedder_from_env(timeout: float = 5, max_retries: int = 0) -> Embedder | None:
    """The defaults suit a search, which embeds one query and must fail fast; ingest batches pass more."""
    key = os.environ.get("LLM_API_KEY")
    if not key:
        return None
    return OpenAIEmbedder(
        os.environ.get("LLM_BASE_URL", "https://ai.boxapi.ir/ai/v1"),
        key,
        os.environ.get("EMBEDDING_MODEL", "text-embedding-3-small"),
        int(os.environ.get("EMBEDDING_DIMENSIONS", "512")),
        timeout,
        max_retries,
    )
