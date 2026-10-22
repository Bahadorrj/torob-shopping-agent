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
