from datetime import datetime
from zoneinfo import ZoneInfo

from pasazhgard.api import app, get_now

ANKER = "product_92ac53fa75e18e8e73f20b56"
# a point inside the Aladdin pasaj, at shop دیسیلا مانسا
ALADDIN = {"lat": 35.69483032610498, "lon": 51.41152782573596}


def sellers(client, product_id=ANKER, **params):
    r = client.get(f"/products/{product_id}/sellers", params=params)
    assert r.status_code == 200, r.text
    return r.json()


def kinds(row):
    return [r["kind"] for r in row["reasons"]]


def names(result):
    return [s["shop_name"] for s in result["sellers"]]


def test_cheapest_first_and_unpriced_last(client):
    result = sellers(client)
    assert result["count"] == 8
    assert names(result) == [
        "نیکورا ویوان", "دیسورا پاکیار", "نیین ماهیس", "نیکسا مانوش", "آذرنوش دیسیس", "دیسیلا مانسا",
        # far from median and missing prices are not shown
        "مهردیس سروورا", "دیسآرا مانوش",
    ]
    first, last = result["sellers"][0], result["sellers"][-1]
    assert (first["price_toman"], first["trust_level"], first["price_age_days"]) == (1690000, "listed", 13)
    assert (last["price_toman"], last["trust_level"]) == (None, "unknown")
    assert first["shop_id"] == "shop_c060bc5ea37b78e00ece4bdb"
    assert (first["area"], first["pasaj"]) == ("شیخ هادی", "علاالدین")


def test_radius_around_origin(client):
    result = sellers(client, **ALADDIN, radius_m=300)
    # دیسآرا مانوش in تجارت جهانی is about 1 km away
    assert result["count"] == 7
    assert "دیسآرا مانوش" not in names(result)
    assert result["sellers"][0]["distance_m"] < 30


def test_named_area(client):
    result = sellers(client, area="فردوسی")
    assert (result["count"], set(names(result))) == (2, {"نیین ماهیس", "دیسآرا مانوش"})


def test_one_pasaj(client):
    result = sellers(client, pasaj="علاالدین")
    assert set(names(result)) == {"نیکورا ویوان", "دیسورا پاکیار", "آذرنوش دیسیس", "دیسیلا مانسا"}


def test_area_picker_lists_covered_areas_and_pasajs(client):
    result = sellers(client)
    assert result["areas"] == sorted(["فردوسی", "شیخ هادی", "بهارستان"])
    assert "علاالدین" in result["pasajs"]


def test_bad_area_queries(client):
    assert client.get(f"/products/{ANKER}/sellers", params={"radius_m": 300}).status_code == 422
    assert client.get(f"/products/{ANKER}/sellers", params={"area": "فردوسی", "pasaj": "علاالدین"}).status_code == 422
    assert client.get("/products/product_missing/sellers").status_code == 404


def test_closest_preset(client):
    result = sellers(client, **ALADDIN, priority="closest")
    assert names(result)[0] == "دیسیلا مانسا"
    assert names(result)[-1] == "دیسآرا مانوش"


def test_most_reliable_preset(client):
    # the test clock is 2026-10-21; every price here changed 8-30 days ago except مهردیس سروورا's
    result = sellers(client, priority="most_reliable")
    # 18-month warranty and declared hours
    assert names(result)[0] == "دیسیلا مانسا"
    # then one of warranty or declared hours, cheapest first
    assert names(result)[1:5] == ["نیکورا ویوان", "نیین ماهیس", "نیکسا مانوش", "آذرنوش دیسیس"]
    assert names(result)[-1] == "مهردیس سروورا"


def test_reason_chips(client):
    rows = {s["shop_name"]: s for s in sellers(client, **ALADDIN)["sellers"]}
    # the clock reads Wednesday 12:00, when both are open
    assert kinds(rows["نیکورا ویوان"]) == ["cheapest", "open_now", "declared_hours"]
    assert kinds(rows["دیسیلا مانسا"]) == ["closest", "open_now", "warranty", "declared_hours"]
    assert rows["دیسیلا مانسا"]["reasons"][2]["months"] == 18
    # a warranty without a term is not a reason
    assert kinds(rows["دیسورا پاکیار"]) == []
    assert rows["دیسیلا مانسا"]["warranty"]["months"] == 18


def test_fresh_price_is_a_reason(client):
    saved = app.dependency_overrides[get_now]
    app.dependency_overrides[get_now] = lambda: datetime(2026, 10, 12, 12, 0, tzinfo=ZoneInfo("Asia/Tehran"))
    try:
        rows = {s["shop_name"]: s for s in sellers(client)["sellers"]}
    finally:
        app.dependency_overrides[get_now] = saved
    # changed 2026-10-05 and 2026-09-29: 7 and 13 days before the clock
    assert "fresh_price" in kinds(rows["آذرنوش دیسیس"])
    assert "fresh_price" not in kinds(rows["نیین ماهیس"])


def test_dropped_prices_rank_last_and_one_row_per_shop(client):
    # placeholder price 700 is dropped; رووش آوین lists it twice (10000, and 70000 far from median)
    rows = sellers(client, "product_925e0c74f43d3d736ca74bc4")["sellers"]
    assert [(r["shop_name"], r["price_toman"]) for r in rows] == [
        ("نیین پاکدیس", 8063), ("مهرسا فرورا", 10000), ("رووش آوین", 10000), ("نییسا سروسا", None),
    ]


def test_category_only_shops_in_their_own_group(client):
    result = sellers(client)
    # these shops list other headphones, not this one
    assert [s["shop_name"] for s in result["category_only"]] == ["رامیلا رامیرا", "نیکآرا نوینا"]
    assert {s["trust_level"] for s in result["category_only"]} == {"category_only"}
    has_product = {s["shop_id"] for s in result["sellers"]}
    assert not has_product & {s["shop_id"] for s in result["category_only"]}
    assert result["count"] == 8


def test_category_only_shops_follow_the_area(client):
    assert [s["shop_name"] for s in sellers(client, area="فردوسی")["category_only"]] == ["نیکآرا نوینا"]


def test_one_seller_gets_no_comparison_chips(client):
    result = sellers(client, "product_3e0ba087e59bbe02a39b6341", **ALADDIN)
    assert result["count"] == 1
    assert kinds(result["sellers"][0]) == []
    assert result["nearest_covered"] is None


PUMP = "product_09415775da3392846abdb072"  # one seller, in بهارستان


def test_empty_area_suggests_the_nearest_covered_area(client):
    result = sellers(client, PUMP, area="فردوسی")
    assert (result["count"], result["sellers"]) == (0, [])
    nearest = result["nearest_covered"]
    assert (nearest["area"], nearest["pasaj"]) == ("بهارستان", "صدقی نژاد")
    # measured from the middle of the Ferdowsi shops, a few hundred metres away
    assert 200 < nearest["distance_m"] < 1000


def test_empty_radius_suggests_the_nearest_covered_area(client):
    nearest = sellers(client, PUMP, **ALADDIN, radius_m=500)["nearest_covered"]
    assert nearest["area"] == "بهارستان"
    assert 1000 < nearest["distance_m"] < 2000


def test_unknown_area_still_suggests_one(client):
    nearest = sellers(client, PUMP, area="تجریش")["nearest_covered"]
    assert (nearest["area"], nearest["distance_m"]) == ("بهارستان", None)


def test_per_meter_prices_do_not_beat_per_piece_ones(database_url, now):
    import psycopg
    from psycopg.rows import dict_row

    from pasazhgard.sellers import SellerQuery, find_sellers

    cable = "product_5533cda8594ee03ac993685a"  # two per-meter offers: 436,000 and 3,600,000 a meter
    with psycopg.connect(database_url, row_factory=dict_row) as conn:
        only_meters = find_sellers(conn, cable, SellerQuery(), now).sellers
        assert [(r.price_toman, "cheapest" in kinds(r.model_dump())) for r in only_meters] == [(436000, True), (3600000, False)]
        # a whole roll from another shop: a dearer number, but not comparable with a meter price
        conn.execute(
            "INSERT INTO offers (offer_id, product_id, shop_id, seller_title, price_toman, price_flags)"
            " VALUES ('offer_roll', %s, 'shop_c060bc5ea37b78e00ece4bdb', 'حلقه 100 متری', 5000000, '{}')",
            [cable],
        )
        rows = find_sellers(conn, cable, SellerQuery(), now).sellers
        conn.rollback()
    assert [(r.price_toman, r.per_meter) for r in rows] == [(5000000, False), (436000, True), (3600000, True)]
    # the meter prices are not compared with the roll, and the roll has no per-piece rival
    assert [r.shop_id for r in rows if "cheapest" in kinds(r.model_dump())] == []


def test_rows_carry_the_shop_location_for_the_map(client):
    row = next(s for s in sellers(client)["sellers"] if s["shop_name"] == "دیسیلا مانسا")
    assert (row["lat"], row["lon"]) == (ALADDIN["lat"], ALADDIN["lon"])
