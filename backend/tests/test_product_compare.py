R50I = "product_92ac53fa75e18e8e73f20b56"
R50I_NC = "product_13f930f4c1400c7ab7bfa61f"
R60I_NC = "product_e372fa27c7d7c5c171c14858"
QCY = "product_a0b9dc5ecc796b0f79a33cf3"


def test_product_detail_has_full_specs_and_images(client):
    r = client.get(f"/products/{R50I}")
    assert r.status_code == 200, r.text
    product = r.json()
    assert product["title"] == "هدفون بلوتوثی انکر Soundcore R50i مدل A3949"
    assert (product["brand"], product["category"]) == ("انکر", "هدفون، هدست و هندزفری")
    assert all(u.startswith("https://image.torob.com/") for u in product["image_urls"])
    # every spec row, including the brand and model rows the card leaves out
    assert product["specs"][:3] == [
        {"key": "رنگ", "value": "سرمه ای, سفید, مشکی"},
        {"key": "برند", "value": "انکر"},
        {"key": "مدل", "value": "R50i"},
    ]
    assert len(product["specs"]) > 3


def test_unknown_product_is_404(client):
    assert client.get("/products/product_missing").status_code == 404



def new_session(client):
    r = client.post("/sessions")
    assert r.status_code == 201, r.text
    return r.json()["session_id"]


def compare(client, product_ids, brief=None, status=200):
    sid = new_session(client)
    r = client.patch(f"/sessions/{sid}", json={"brief": brief or {}, "step": {"kind": "compare", "product_ids": product_ids}})
    assert r.status_code == status, r.text
    return r.json()["results"] if status == 200 else r.json()


def spec_row(result, key):
    return next(row for row in result["specs"] if row["key"] == key)


def test_spec_diff_marks_rows_that_differ(client):
    result = compare(client, [R50I, R50I_NC])
    assert [p["product_id"] for p in result["products"]] == [R50I, R50I_NC]
    assert [p["title"] for p in result["products"]] == [
        "هدفون بلوتوثی انکر Soundcore R50i مدل A3949",
        "هندزفری بلوتوثی انکر مدل Soundcore R50i NC A3959",
    ]
    assert spec_row(result, "رنگ") == {"key": "رنگ", "values": ["سرمه ای, سفید, مشکی", "سفید, مشکی"], "differs": True}
    assert spec_row(result, "نسخه بلوتوث") == {"key": "نسخه بلوتوث", "values": ["5.3", "5.3"], "differs": False}
    # a spec only one product records differs, and the other side is unknown
    assert spec_row(result, "وزن ایرفون به همراه کیس") == {"key": "وزن ایرفون به همراه کیس", "values": ["60گرم", None], "differs": True}
    assert spec_row(result, "ظرفیت باتری")["values"] == [None, "480 میلی‌آمپر"]


def test_compare_holds_two_to_three_products(client):
    assert len(compare(client, [R50I, R50I_NC, R60I_NC])["products"]) == 3
    compare(client, [R50I, R50I_NC, R60I_NC, QCY], status=422)
    compare(client, [R50I], status=422)
    # the same product twice is one product
    compare(client, [R50I, R50I], status=422)
    compare(client, [R50I, "product_missing"], status=404)


def test_nearby_price_sellers_and_warranty_carry_trust_levels(client):
    r50i, nc = compare(client, [R50I, R50I_NC])["products"]
    # with no area, nearby is every covered shop
    assert r50i["price"] == {
        "trust_level": "listed",
        "min_toman": 1690000,
        "max_toman": 3500000,
        "per_meter": False,
        "last_price_changed_at": "2026-10-08T15:04:48.906406Z",
        "price_age_days": 13,
        "price_age_bucket": "8-30",
    }
    assert r50i["seller_count"] == 8
    # 18 months at دیسیلا مانسا and نیکسا مانوش ("18ماه" in the text); "تایید اصالت" has no term and does not count
    assert r50i["warranty"] == {"trust_level": "listed", "sellers": 2, "max_months": 18}
    assert nc["warranty"]["max_months"] == 36


def test_nearby_follows_the_brief_area(client):
    r50i, nc = compare(client, [R50I, R50I_NC], brief={"area": {"name": "فردوسی"}})["products"]
    # نیین ماهیس at 3,044,000 and دیسآرا مانوش without a price
    assert (r50i["seller_count"], r50i["price"]["min_toman"], r50i["price"]["max_toman"]) == (2, 3044000, 3044000)
    assert r50i["warranty"] == {"trust_level": "unknown", "sellers": 0, "max_months": None}
    assert nc["seller_count"] == 1


def test_no_seller_in_the_area_is_unknown_not_blank(client):
    r50i, _ = compare(client, [R50I, R50I_NC], brief={"area": {"name": "بهارستان"}})["products"]
    assert r50i["seller_count"] == 0
    assert (r50i["price"]["trust_level"], r50i["price"]["min_toman"]) == ("unknown", None)
    assert r50i["warranty"]["trust_level"] == "unknown"


def read_compare(client, ids, status=200, **area):
    r = client.get("/products/compare", params={"ids": ids, **area})
    assert r.status_code == status, r.text
    return r.json()


def test_compare_read_matches_the_session_step(client):
    assert read_compare(client, [R50I, R50I_NC]) == compare(client, [R50I, R50I_NC])
    assert read_compare(client, [R50I, R50I_NC], area="فردوسی") == compare(client, [R50I, R50I_NC], brief={"area": {"name": "فردوسی"}})


def test_compare_read_takes_two_to_three_distinct_known_products(client):
    assert len(read_compare(client, [R50I, R50I_NC, R60I_NC])["products"]) == 3
    read_compare(client, [R50I, R50I_NC, R60I_NC, QCY], status=422)
    read_compare(client, [R50I], status=422)
    read_compare(client, [R50I, R50I], status=422)
    read_compare(client, [R50I, R50I_NC], status=422, radius_m=300)
    read_compare(client, [R50I, "product_missing"], status=404)
