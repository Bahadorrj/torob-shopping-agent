from datetime import datetime
from zoneinfo import ZoneInfo

from pasazhgard.api import app, get_now

ANKER = "product_92ac53fa75e18e8e73f20b56"
MANSA = "offer_948daebb31460ccf0b260704"  # دیسیلا مانسا: 3,500,000, 18-month warranty, fast delivery
MANUSH = "offer_73254108e9f0882302b30908"  # دیسآرا مانوش: no price, about 1 km from Aladdin
PAKYAR = "offer_3c3d14695e8beea205c20a8c"  # دیسورا پاکیار: hours not recorded
MAHIS = "offer_4482530cb944bbe32546da26"  # نیین ماهیس: declares اسنپ‌پی
ALADDIN = {"lat": 35.69483032610498, "lon": 51.41152782573596}


def compare(client, *offers, product_id=ANKER, **params):
    r = client.get(f"/products/{product_id}/sellers/compare", params={"offer_id": list(offers), **params})
    assert r.status_code == 200, r.text
    return r.json()


def test_up_to_three_sellers_side_by_side(client):
    result = compare(client, MANSA, MAHIS, PAKYAR)
    assert result["title"]
    cols = result["sellers"]
    assert [c["shop_name"] for c in cols] == ["دیسیلا مانسا", "نیین ماهیس", "دیسورا پاکیار"]
    mansa, mahis = cols[0], cols[1]
    assert (mansa["price_toman"], mansa["trust_level"], mansa["price_age_days"], mansa["price_age_bucket"]) == (3500000, "listed", 22, "8-30")
    assert mansa["warranty"]["months"] == 18
    assert mansa["fast_delivery"] == "yes"
    assert (mansa["pasaj"], mansa["shop_id"]) == ("علاالدین", "shop_e31a5b73908ea869f50af78e")
    assert mahis["payment_options"] == [{"provider": "اسنپ‌پی", "channel": "unknown"}]


def test_more_than_three_or_none_is_rejected(client):
    url = f"/products/{ANKER}/sellers/compare"
    assert client.get(url, params={"offer_id": [MANSA, MAHIS, PAKYAR, MANUSH]}).status_code == 422
    assert client.get(url).status_code == 422
    assert client.get(url, params={"offer_id": [MANSA, MANSA]}).status_code == 422
    assert client.get(url, params={"offer_id": MANSA, "lat": 35.69}).status_code == 422
    # a visit time without a timezone is ambiguous
    assert client.get(url, params={"offer_id": MANSA, "arrival": "2026-10-21T19:00:00"}).status_code == 422


def test_unknown_product_or_offer(client):
    assert client.get("/products/product_missing/sellers/compare", params={"offer_id": MANSA}).status_code == 404
    assert client.get(f"/products/{ANKER}/sellers/compare", params={"offer_id": "offer_missing"}).status_code == 404
    # an offer of another product
    other = "product_925e0c74f43d3d736ca74bc4"
    assert client.get(f"/products/{other}/sellers/compare", params={"offer_id": MANSA}).status_code == 404


def test_unknown_fields_stay_unknown_and_latest_price_is_not_asked(client):
    manush = compare(client, MANUSH)["sellers"][0]
    assert (manush["price_toman"], manush["trust_level"], manush["price_age_days"]) == (None, "unknown", None)
    assert (manush["warranty"], manush["payment_options"], manush["fast_delivery"]) == (None, [], "unknown")
    # no origin: distance and travel time are not known
    assert (manush["distance_m"], manush["travel_min"]) == (None, None)
    # no inquiry or website fetch exists yet
    for col in compare(client, MANSA, MANUSH)["sellers"]:
        assert col["latest_price"] == {"status": "not_asked", "price_toman": None, "trust_level": "unknown", "at": None}


def test_distance_and_time_are_straight_line_estimates(client):
    result = compare(client, MANUSH, MANSA, **ALADDIN)
    assert (result["travel_mode"], result["travel_estimate"]) == ("walk", "straight_line")
    manush, mansa = result["sellers"]
    # 999 m in a straight line; walking 4.5 km/h, rounded up to whole minutes
    assert (manush["distance_m"], manush["travel_min"]) == (999, 14)
    assert (mansa["distance_m"], mansa["travel_min"]) == (0, 0)
    # transit 15 km/h, car 20 km/h
    assert compare(client, MANUSH, **ALADDIN, mode="transit")["sellers"][0]["travel_min"] == 4
    assert compare(client, MANUSH, **ALADDIN, mode="car")["sellers"][0]["travel_min"] == 3


def test_open_at_the_visit_time(client):
    mansa, manush, pakyar = compare(client, MANSA, MANUSH, PAKYAR, arrival="2026-10-21T19:00:00+03:30")["sellers"]
    # Wednesday: مانسا 10:00-20:30, مانوش 10:30-18:15, پاکیار not recorded
    assert [c["open_at_arrival"] for c in (mansa, manush, pakyar)] == [True, False, None]
    assert mansa["arrival_at"] == "2026-10-21T19:00:00+03:30"


def test_without_a_visit_time_arrival_is_now_plus_travel(client):
    saved = app.dependency_overrides[get_now]
    app.dependency_overrides[get_now] = lambda: datetime(2026, 10, 21, 18, 5, tzinfo=ZoneInfo("Asia/Tehran"))
    try:
        mansa, manush = compare(client, MANSA, MANUSH, **ALADDIN)["sellers"]
        no_origin = compare(client, MANUSH)["sellers"][0]
    finally:
        app.dependency_overrides[get_now] = saved
    # مانوش closes at 18:15: open now, but closed after the 14-minute walk
    assert (manush["open_now"], manush["open_at_arrival"], manush["arrival_at"]) == (True, False, "2026-10-21T18:19:00+03:30")
    assert (mansa["open_at_arrival"], mansa["arrival_at"]) == (True, "2026-10-21T18:05:00+03:30")
    assert (no_origin["open_at_arrival"], no_origin["arrival_at"]) == (True, "2026-10-21T18:05:00+03:30")
