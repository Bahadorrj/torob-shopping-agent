import json
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer

import pytest

from pasazhgard.embeddings import embedder_from_env


@pytest.fixture
def gateway():
    """A local OpenAI-compatible /embeddings endpoint that records request bodies."""
    requests = []

    class Handler(BaseHTTPRequestHandler):
        def do_POST(self):
            body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
            requests.append({"path": self.path, "auth": self.headers["Authorization"], **body})
            data = [{"object": "embedding", "index": i, "embedding": [float(i), 1.0]} for i in range(len(body["input"]))]
            out = json.dumps({"object": "list", "data": data, "model": body["model"], "usage": {"prompt_tokens": 1, "total_tokens": 1}}).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(out)))
            self.end_headers()
            self.wfile.write(out)

        def log_message(self, *args):
            pass

    server = HTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    yield f"http://127.0.0.1:{server.server_port}/v1", requests
    server.shutdown()


def test_without_a_key_there_is_no_provider(monkeypatch):
    monkeypatch.delenv("LLM_API_KEY", raising=False)
    assert embedder_from_env() is None


def test_adapter_sends_raw_text_to_an_openai_compatible_gateway(gateway, monkeypatch):
    url, requests = gateway
    monkeypatch.setenv("LLM_API_KEY", "test-key")
    monkeypatch.setenv("LLM_BASE_URL", url)
    monkeypatch.setenv("EMBEDDING_MODEL", "text-embedding-3-small")
    monkeypatch.setenv("EMBEDDING_DIMENSIONS", "2")
    monkeypatch.setenv("NO_PROXY", "127.0.0.1")
    embedder = embedder_from_env()
    assert (embedder.name, embedder.dimensions) == ("text-embedding-3-small/2", 2)
    assert embedder.embed(["هدفون انکر", "کابل"]) == [[0.0, 1.0], [1.0, 1.0]]
    # raw strings, not tiktoken ids: the gateway is not OpenAI and tiktoken downloads may be blocked
    [r] = requests
    assert (r["path"], r["auth"], r["model"], r["dimensions"]) == ("/v1/embeddings", "Bearer test-key", "text-embedding-3-small", 2)
    assert r["input"] == ["هدفون انکر", "کابل"]
