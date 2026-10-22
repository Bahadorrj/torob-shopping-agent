import os
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

import psycopg
import pytest
from fastapi.testclient import TestClient

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
    from pasazhgard.api import app, get_embedder, get_now, get_router
    from pasazhgard.routing import StraightLine

    app.dependency_overrides[get_now] = lambda: now
    # lexical unless a test plugs in the fake; never the real provider from the developer's env
    app.dependency_overrides[get_embedder] = lambda: None
    app.dependency_overrides[get_router] = lambda: StraightLine()
    with TestClient(app) as c:
        yield c
