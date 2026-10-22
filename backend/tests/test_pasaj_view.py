import pytest

from pasazhgard.pasaj import floor_level

R50I = "product_92ac53fa75e18e8e73f20b56"


def view(client, pasaj, **params):
    r = client.get(f"/pasajs/{pasaj}", params=params)
    assert r.status_code == 200, r.text
    return r.json()


def floors(v):
    return [(f["floor"], [s["shop_id"] for s in f["shops"]]) for f in v["floors"]]


def test_shops_with_the_product_grouped_and_ordered_by_floor(client):
    v = view(client, "علاالدین", product_id=R50I)
    assert v["pasaj"] == "علاالدین"
    assert floors(v) == [
        ("زیر همکف", ["shop_c060bc5ea37b78e00ece4bdb"]),
        ("همکف", ["shop_e31a5b73908ea869f50af78e"]),
        ("۲", ["shop_81c53acd00d779578fff4a40"]),
        ("5", ["shop_4934392f0e4fefe1526308c6"]),
    ]
    shop = v["floors"][2]["shops"][0]
    assert shop["unit"] == "۲۱۶"
    assert [p["product_id"] for p in shop["products"]] == [R50I]
    assert shop["products"][0]["price_toman"] > 0


def test_without_a_product_every_shop_shows_and_unknown_floors_come_last(client):
    v = view(client, "علاالدین")
    assert v["count"] == 8
    assert [f["floor"] for f in v["floors"]] == ["زیر همکف", "همکف", "۲", "سوم", "5", None]
    assert [s["shop_id"] for s in v["floors"][-1]["shops"]] == ["shop_d4b7098382f4a0552c80e36b"]
    assert all(s["products"] == [] for f in v["floors"] for s in f["shops"])


def test_the_brief_picks_the_products(client):
    sid = client.post("/sessions").json()["session_id"]
    redmi, airpods = "product_0b67b5b491a96d23c5ec9d2a", "product_87275da84ee308b9814d5085"
    r = client.patch(f"/sessions/{sid}", json={"brief": {"items": [{"product_id": airpods}]}, "step": {"kind": "sellers", "product_id": redmi}})
    assert r.status_code == 200, r.text
    v = view(client, "علاالدین", session_id=sid)
    assert floors(v) == [("زیر همکف", ["shop_c060bc5ea37b78e00ece4bdb"]), ("همکف", ["shop_e31a5b73908ea869f50af78e"])]
    assert [p["product_id"] for p in v["floors"][1]["shops"][0]["products"]] == [redmi]


def test_unknown_pasaj_or_session(client):
    assert client.get("/pasajs/nope").status_code == 404
    assert client.get("/pasajs/علاالدین", params={"session_id": "nope"}).status_code == 404


@pytest.mark.parametrize(
    ("floor", "level"),
    [
        ("همکف", 0), ("همكف", 0), ("زیرهمکف", -1), ("زیر زمین", -1), ("منفی ۲", -2), ("منفی۱", -1), ("۱-", -1),
        ("-1", -1), ("ـ۱", -1), ("اول", 1), ("‌ی اول", 1), ("اول جنوبی", 1), ("سوم", 3), ("چهار", 4), ("۱۱ شمالی", 11),
        ("3A", 3), ("بالای همکف", None), (None, None),
    ],
)
def test_floor_spellings(floor, level):
    assert floor_level(floor) == level
