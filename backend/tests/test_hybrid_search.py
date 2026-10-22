import pytest

from pasazhgard.api import app, get_embedder
from pasazhgard.ingest import ingest

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


def test_reingest_embeds_only_new_texts(hybrid, embedder, database_url, fixture_dir):
    before = ids(hybrid, "هندزفری ورزشی")
    embedder.calls.clear()
    ingest(fixture_dir, database_url, embedder)
    assert embedder.calls == []
    assert ids(hybrid, "هندزفری ورزشی") == before


ANKER = {R50I, "product_13f930f4c1400c7ab7bfa61f", "product_e372fa27c7d7c5c171c14858"}


@pytest.mark.parametrize(
    "query, expected",
    [
        # titles spell the brand "انکر"; "Anker" comes from one product's brand spec
        ("anker", ANKER),
        ("انکر", ANKER),
        ("ANKER r50i", {R50I, "product_13f930f4c1400c7ab7bfa61f"}),
        # the QCY title names no brand; its brand is شیائومی, "Xiaomi" in another product's spec
        ("هدفون xiaomi", {"product_0b67b5b491a96d23c5ec9d2a", "product_a0b9dc5ecc796b0f79a33cf3"}),
    ],
)
def test_english_and_persian_brand_names_match(client, query, expected):
    assert set(ids(client, query)[: len(expected)]) == expected


def test_products_of_the_named_brand_rank_first(hybrid):
    # every headphone is a semantic match for "هندزفری"; the Anker ones are what the query names
    assert set(ids(hybrid, "هندزفری انکر")[:3]) == ANKER


def test_products_in_the_named_category_rank_first(client):
    # "سیم" is also in every "هدفون بی سیم" title; wire is what the categories call "سیم"
    assert set(ids(client, "سیم")[:2]) == {"product_91fc2714e7673b537827ec61", "product_bd777713ec013d56cf083c9a"}


class DownEmbedder:
    name, dimensions = "fake/2", 2

    def embed(self, texts):
        raise TimeoutError("provider unreachable")


def test_search_is_lexical_when_the_provider_is_down(client):
    lexical = ids(client, "هندزفری ورزشی")
    app.dependency_overrides[get_embedder] = DownEmbedder
    try:
        assert ids(client, "هندزفری ورزشی") == lexical
    finally:
        app.dependency_overrides[get_embedder] = lambda: None
