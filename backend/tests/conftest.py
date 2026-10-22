import asyncio
import json
import os
import uuid
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

import psycopg
import pytest
from fastapi.testclient import TestClient
from langchain_core.language_models.fake_chat_models import GenericFakeChatModel
from langchain_core.messages import AIMessage, AIMessageChunk
from langchain_core.outputs import ChatGenerationChunk

from pasazhgard.api import get_chat_model, get_small_model
from pasazhgard.grounding import known_shops, ungrounded_turn
from pasazhgard.normalize import normalize

ADMIN_URL = os.environ.get("TEST_ADMIN_DATABASE_URL", "postgresql://postgres:postgres@localhost:5432/postgres")
TEST_DB = os.environ.get("TEST_DB_NAME", "pasazhgard_test")


@pytest.fixture(scope="session")
def fixture_dir():
    return Path(__file__).parent / "fixtures" / "dataset"


@pytest.fixture(scope="session")
def now():
    return datetime(2026, 10, 21, 12, 0, tzinfo=ZoneInfo("Asia/Tehran"))


class FakeEmbedder:
    """The embedding port in tests: texts that name the same concept point the same way."""

    name = "fake/2"
    concepts = [("هدفون", "هندزفری", "ایرفون", "هدست"), ("ورزش",)]
    dimensions = len(concepts)

    def __init__(self):
        self.calls = []

    def embed(self, texts):
        self.calls.append(texts)
        # a text without a concept is the zero vector, which is no text's neighbour
        return [[float(any(w in normalize(t) for w in c)) for c in self.concepts] for t in texts]


@pytest.fixture(scope="session")
def embedder():
    return FakeEmbedder()


@pytest.fixture(scope="session")
def database_url(fixture_dir, embedder):
    with psycopg.connect(ADMIN_URL, autocommit=True) as conn:
        conn.execute(f"DROP DATABASE IF EXISTS {TEST_DB} WITH (FORCE)")
        conn.execute(f"CREATE DATABASE {TEST_DB}")
    url = ADMIN_URL.rsplit("/", 1)[0] + "/" + TEST_DB
    from pasazhgard.ingest import ingest

    ingest(fixture_dir, url, embedder)
    return url


@pytest.fixture(scope="session")
def client(database_url, now):
    os.environ["DATABASE_URL"] = database_url
    from pasazhgard.api import app, get_console_secret, get_embedder, get_now, get_router
    from pasazhgard.routing import StraightLine

    app.dependency_overrides[get_now] = lambda: now
    # lexical unless a test plugs in the fake; never the real provider from the developer's env
    app.dependency_overrides[get_embedder] = lambda: None
    app.dependency_overrides[get_router] = lambda: StraightLine()
    app.dependency_overrides[get_console_secret] = lambda: "test-console-secret"
    # degraded unless a test scripts the model
    app.dependency_overrides[get_chat_model] = lambda: None
    app.dependency_overrides[get_small_model] = lambda: None
    # the async checkpointer's psycopg cannot run on Windows' default Proactor loop
    with TestClient(app, backend_options={"loop_factory": asyncio.SelectorEventLoop}) as c:
        yield c


class ScriptedModel(GenericFakeChatModel):
    """The chat model port in tests: answers each call with the next scripted message, streamed like a provider."""

    def bind_tools(self, tools, **kwargs):
        return self

    def _stream(self, messages, stop=None, run_manager=None, **kwargs):
        m = next(self.messages)
        if m.content:
            yield ChatGenerationChunk(message=AIMessageChunk(content=m.content, id=m.id))
        # as OpenAI streams a call: name and id first, then the arguments
        for i, c in enumerate(m.tool_calls):
            yield ChatGenerationChunk(message=AIMessageChunk("", id=m.id, tool_call_chunks=[{"name": c["name"], "args": "", "id": c["id"], "index": i}]))
            args = json.dumps(c["args"], ensure_ascii=False)
            yield ChatGenerationChunk(message=AIMessageChunk("", id=m.id, tool_call_chunks=[{"name": None, "args": args, "id": None, "index": i}]))


@dataclass
class Turn:
    events: list[dict]
    # the assistant text of the turn and the tool results it streamed, parsed
    text: str
    blocks: list[dict]


class Agent:
    """Drives /agent as CopilotKit does: one AG-UI run per user message on the session's thread."""

    def __init__(self, client, shops=None):
        self.client = client
        # the data's shop names, for the grounding check
        self.shops = shops
        self.session_id = client.post("/sessions").json()["session_id"]
        # CopilotKit sends the whole thread every run, as the last MESSAGES_SNAPSHOT left it
        self.history: list[dict] = []

    def script(self, *replies: AIMessage | str):
        """The model's replies, in call order. Each turn starts with one `brief(...)` reply."""
        model = ScriptedModel(messages=iter(AIMessage(r) if isinstance(r, str) else r for r in replies))
        self.client.app.dependency_overrides[get_chat_model] = lambda: model

    @staticmethod
    def brief(**patch) -> AIMessage:
        """The structured brief patch of a turn; fields the user did not state stay out."""
        return Agent.call("BriefPatch", **patch)

    @staticmethod
    def call(name: str, **args) -> AIMessage:
        return AIMessage("", tool_calls=[{"name": name, "args": args, "id": uuid.uuid4().hex}], id=uuid.uuid4().hex)

    def turn(self, text: str) -> Turn:
        r = self.client.post(
            "/agent",
            json={
                "threadId": self.session_id,
                "runId": uuid.uuid4().hex,
                "state": {},
                "messages": [*self.history, {"id": uuid.uuid4().hex, "role": "user", "content": text}],
                "tools": [],
                "context": [],
                "forwardedProps": {},
            },
            headers={"accept": "text/event-stream"},
        )
        assert r.status_code == 200, r.text
        events = [json.loads(line[6:]) for line in r.text.splitlines() if line.startswith("data: ")]
        assert events[-1]["type"] == "RUN_FINISHED", events[-1]
        turn = Turn(
            events,
            "".join(e["delta"] for e in events if e["type"] == "TEXT_MESSAGE_CONTENT"),
            [json.loads(e["content"]) for e in events if e["type"] == "TOOL_CALL_RESULT"],
        )
        # every turn of every test is checked against what its tools returned
        self.history = [e for e in events if e["type"] == "MESSAGES_SNAPSHOT"][-1]["messages"]
        missing = ungrounded_turn(self.history, self.shops)
        assert not missing, missing
        return turn


@pytest.fixture(scope="session")
def shops(database_url):
    with psycopg.connect(database_url) as conn:
        return known_shops(conn)


@pytest.fixture
def agent(client, shops):
    yield Agent(client, shops)
    client.app.dependency_overrides[get_chat_model] = lambda: None


@pytest.fixture
def seller_parses(client):
    """Scripts the small model's parses of free-text seller replies, one per reply, as `ReplyParse` fields."""

    def script(*parses: dict):
        model = ScriptedModel(messages=iter(Agent.call("ReplyParse", **p) for p in parses))
        client.app.dependency_overrides[get_small_model] = lambda: model

    yield script
    client.app.dependency_overrides[get_small_model] = lambda: None


@pytest.fixture
def clock(client, now):
    """Moves the API clock for one test: `clock(at)`."""
    from pasazhgard.api import app, get_now

    yield lambda at: app.dependency_overrides.__setitem__(get_now, lambda: at)
    app.dependency_overrides[get_now] = lambda: now


class FakeWeb:
    """The web fetch port in tests: a page per URL prefix, or an exception to raise for it."""

    def __init__(self, pages):
        self.pages = pages
        self.urls = []

    def get(self, url):
        self.urls.append(url)
        page = next((p for prefix, p in self.pages.items() if url.startswith(prefix)), None)
        if page is None or isinstance(page, Exception):
            raise page or LookupError(url)
        return page


@pytest.fixture
def site(client):
    """Scripts a site price fetch: `site(pages, *parses)`, pages by URL prefix, parses as `SitePriceParse` fields."""
    from pasazhgard.api import app, get_web_fetch

    def script(pages, *parses: dict):
        web = FakeWeb(pages)
        model = ScriptedModel(messages=iter(Agent.call("SitePriceParse", **p) for p in parses))
        app.dependency_overrides[get_web_fetch] = lambda: web
        app.dependency_overrides[get_small_model] = lambda: model
        return web

    yield script
    app.dependency_overrides.pop(get_web_fetch, None)
    app.dependency_overrides[get_small_model] = lambda: None
