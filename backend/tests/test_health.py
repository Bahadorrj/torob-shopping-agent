def test_health_ok_without_llm_or_map_keys(client, monkeypatch):
    monkeypatch.delenv("LLM_API_KEY", raising=False)
    monkeypatch.delenv("NESHAN_API_KEY", raising=False)

    r = client.get("/health")

    assert r.status_code == 200
    assert r.json() == {"status": "ok", "db": "ok", "llm": False, "maps": False}
    # degraded mode still serves search
    assert client.get("/products/search", params={"q": "هدفون"}).json()["items"]


def test_health_reports_configured_keys(client, monkeypatch):
    monkeypatch.setenv("LLM_API_KEY", "k")
    monkeypatch.setenv("NESHAN_API_KEY", "k")

    body = client.get("/health").json()

    assert body["llm"] is True
    assert body["maps"] is True


def test_health_fails_when_db_unreachable(client, monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "postgresql://postgres:postgres@localhost:1/none")

    r = client.get("/health")

    assert r.status_code == 503
    assert r.json()["db"] == "unreachable"
