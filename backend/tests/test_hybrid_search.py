import pytest

from pasazhgard.api import app, get_embedder

R50I = "product_92ac53fa75e18e8e73f20b56"


def ids(client, q):
    r = client.get("/products/search", params={"q": q})
    assert r.status_code == 200, r.text
    return [c["product_id"] for c in r.json()["items"]]


@pytest.fixture
def hybrid(client, embedder):
    app.dependency_overrides[get_embedder] = lambda: embedder
    yield client
    app.dependency_overrides[get_embedder] = lambda: None


def test_search_finds_products_by_meaning(hybrid):
    # the R50i title says "هدفون", not "هندزفری", and nothing about sport
    assert R50I in ids(hybrid, "هندزفری ورزشی")


def test_without_a_provider_search_is_lexical(client):
    assert ids(client, "هندزفری ورزشی") == ["product_13f930f4c1400c7ab7bfa61f"]
