import os
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

import psycopg
import pytest
from fastapi.testclient import TestClient

ADMIN_URL = os.environ.get("TEST_ADMIN_DATABASE_URL", "postgresql://postgres:postgres@localhost:5432/postgres")
TEST_DB = os.environ.get("TEST_DB_NAME", "pasazhgard_test")


@pytest.fixture(scope="session")
def fixture_dir():
    return Path(__file__).parent / "fixtures" / "dataset"


@pytest.fixture(scope="session")
def now():
    return datetime(2026, 10, 21, 12, 0, tzinfo=ZoneInfo("Asia/Tehran"))


@pytest.fixture(scope="session")
def database_url(fixture_dir):
    with psycopg.connect(ADMIN_URL, autocommit=True) as conn:
        conn.execute(f"DROP DATABASE IF EXISTS {TEST_DB} WITH (FORCE)")
        conn.execute(f"CREATE DATABASE {TEST_DB}")
    url = ADMIN_URL.rsplit("/", 1)[0] + "/" + TEST_DB
    from pasazhgard.ingest import ingest

    ingest(fixture_dir, url)
    return url


@pytest.fixture(scope="session")
def client(database_url, now):
    os.environ["DATABASE_URL"] = database_url
    from pasazhgard.api import app, get_now

    app.dependency_overrides[get_now] = lambda: now
    with TestClient(app) as c:
        yield c
