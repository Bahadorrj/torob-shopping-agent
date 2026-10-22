R50I = "product_92ac53fa75e18e8e73f20b56"
R50I_NC = "product_13f930f4c1400c7ab7bfa61f"


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
