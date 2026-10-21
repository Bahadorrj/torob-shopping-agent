from datetime import datetime

import psycopg
import pytest

from pasazhgard.api import app, get_now
from pasazhgard.ingest import ingest
from pasazhgard.search import _product_flags

R50I = "product_92ac53fa75e18e8e73f20b56"


def search(client, q):
    r = client.get("/products/search", params={"q": q})
    assert r.status_code == 200, r.text
    return r.json()["items"]


def test_product_card(client):
    card = search(client, "هدفون انکر R50i")[0]
    assert card["product_id"] == R50I
    assert card["title"] == "هدفون بلوتوثی انکر Soundcore R50i مدل A3949"
    assert card["image_url"].startswith("https://image.torob.com/")
    # brand, model and name rows are left out: the title already says them
    assert card["key_specs"] == [
        {"key": "رنگ", "value": "سرمه ای, سفید, مشکی"},
        {"key": "وزن ایرفون به همراه کیس", "value": "60گرم"},
        {"key": "نوع اتصال", "value": "بی سیم"},
    ]
    assert card["offer_count"] == 8
    assert card["price"] == {
        "trust_level": "listed",
        "min_toman": 1690000,
        "max_toman": 3500000,
        "per_meter": False,
        "last_price_changed_at": "2026-10-08T15:04:48.906406Z",
        "price_age_days": 13,
        "price_age_bucket": "8-30",
    }
    # one offer has no price, one is far from the median and is left out of the range
    assert card["price_flags"] == ["missing", "far_from_median"]


@pytest.mark.parametrize(
    "query, product_id",
    [
        ("كليد اتوماتيك ۴۰ آمپر اشنايدر", "product_17ecdf2bf4e2e78dc9652a19"),  # Arabic yeh/kaf, Persian digits
        ("پاوربانک شیائومی ۲۰۰۰۰ میلی آمپر", "product_3e0ba087e59bbe02a39b6341"),  # title has ZWNJ
        ("ایرپاد پرو ۲", "product_87275da84ee308b9814d5085"),
        ("پنل 10 شاسی کوماکس", "product_afbeef5118076188aa5de0fb"),  # title has Arabic digits
        ("هدفون بی‌سیم شیائومی redmi buds", "product_0b67b5b491a96d23c5ec9d2a"),  # title has a tab
        ("ضبط کننده ویدیویی داهوا", "product_1b6783682cab7f15c10b887a"),  # title spells it with hamza
        ("هندزفری انکر r50i nc", "product_13f930f4c1400c7ab7bfa61f"),
    ],
)
def test_search_matches_despite_spelling(client, query, product_id):
    assert search(client, query)[0]["product_id"] == product_id


def card(client, query, product_id):
    return next(c for c in search(client, query) if c["product_id"] == product_id)


def test_missing_price(client):
    c = card(client, "کلید اتوماتیک 160 آمپر زیمنس", "product_c2f4d0a4d9df317cc19b3115")
    assert c["offer_count"] == 3
    assert c["price"] == {
        "trust_level": "unknown",
        "min_toman": None,
        "max_toman": None,
        "per_meter": False,
        "last_price_changed_at": None,
        "price_age_days": None,
        "price_age_bucket": None,
    }
    assert c["price_flags"] == ["missing"]


def test_per_meter_price(client):
    c = card(client, "کابل برق افشان 4*4 کرمان", "product_5533cda8594ee03ac993685a")
    # two per-meter offers are too few to call either one far from the median
    assert (c["price"]["per_meter"], c["price"]["min_toman"], c["price"]["max_toman"]) == (True, 436000, 3600000)
    assert c["price_flags"] == ["per_meter"]


def test_placeholder_price_is_flagged_and_left_out_of_range(client):
    c = card(client, "سیم برق افشان 16*1 زرتافته", "product_bd777713ec013d56cf083c9a")
    # "1 متری" in the seller title prices one meter
    assert (c["price"]["per_meter"], c["price"]["min_toman"], c["price"]["max_toman"]) == (True, 385000, 385000)
    assert c["price_flags"] == ["placeholder", "per_meter"]


def test_per_meter_flag_ignores_offers_without_a_usable_price():
    offers = [{"price_flags": ["missing", "per_meter"]}, {"price_flags": []}]
    assert _product_flags(offers) == ["missing"]
    assert _product_flags([*offers, {"price_flags": ["per_meter"]}]) == ["missing", "per_meter"]


def test_invalid_price_is_flagged_and_left_out_of_range(client):
    c = card(client, "محافظ یخچال پارت الکتریک", "product_a112c972266b57d0f7eddeab")
    assert (c["price"]["min_toman"], c["price"]["max_toman"]) == (1276000, 1436400)
    assert c["price_flags"] == ["invalid"]


def test_price_without_change_date_has_no_age_bucket(client):
    c = card(client, "ریل چراغ مگنتی", "product_db75e39a25b2bc83eca25efe")
    assert c["price"]["trust_level"] == "listed"
    assert (c["price"]["price_age_days"], c["price"]["price_age_bucket"]) == (None, None)


@pytest.mark.parametrize(
    "today, days, bucket",
    [("2026-10-15", 7, "<=7"), ("2026-10-16", 8, "8-30"), ("2026-11-07", 30, "8-30"), ("2026-11-08", 31, ">30")],
)
def test_price_age_bucket_follows_the_clock(client, now, today, days, bucket):
    # newest R50i price changed on 2026-10-08, Tehran time
    saved = app.dependency_overrides[get_now]
    app.dependency_overrides[get_now] = lambda: datetime.fromisoformat(today).replace(hour=9, tzinfo=now.tzinfo)
    try:
        price = card(client, "هدفون انکر R50i", R50I)["price"]
    finally:
        app.dependency_overrides[get_now] = saved
    assert (price["price_age_days"], price["price_age_bucket"]) == (days, bucket)


def test_ingest_is_idempotent(client, database_url, fixture_dir):
    before = search(client, "انکر")
    ingest(fixture_dir, database_url)
    assert search(client, "انکر") == before


def test_reload_does_not_block_reads_during_build(monkeypatch, database_url, fixture_dir):
    from pasazhgard import ingest as ingest_module

    real_copy = ingest_module._copy
    reads = []

    def copy_then_read(cur, table, *args):
        real_copy(cur, table, *args)
        with psycopg.connect(database_url, options="-c lock_timeout=2000") as other:
            reads.append(other.execute("SELECT count(*) FROM public.products").fetchone()[0])

    monkeypatch.setattr(ingest_module, "_copy", copy_then_read)
    ingest(fixture_dir, database_url)
    assert len(reads) == 3 and reads[0] > 0


def test_words_missing_from_the_title_do_not_drop_the_product(client):
    ids = [c["product_id"] for c in search(client, "هدفون بی سیم انکر برای ورزش")]
    assert R50I in ids


def test_punctuation_tokens_do_not_change_results(client):
    assert search(client, "هدفون انکر - R50i /") == search(client, "هدفون انکر R50i")


def test_common_word_does_not_outrank_a_rare_product_word(client):
    # "مناسب برای" is in many titles that are not Anker products
    items = search(client, "مناسب برای انکر")
    assert items
    assert all("انکر" in c["title"] for c in items[:3])
