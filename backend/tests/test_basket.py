from conftest import Agent

CABLE = "product_f25b2a5e1c0de000000000aa"  # سیم افشان 1*2.5 خراسان, priced per meter
BREAKER = "product_44b3433a974ba5e14c41803a"  # کلید مینیاتوری هیوندای ۱۶ آمپر
POWER_STRIPS = "سیم سیار و چندراهی برق"
RAMORA = "shop_00a119069f9cd37c20326044"  # فرین رامورا, Lalehzar: the cable and the cheapest breaker
SCENARIO_B = "سیم افشان ۲.۵ خراسان ۲ حلقه\nمحافظ برق ۱۶ آمپر\nکلید مینیاتوری ۱۶"


def basket(client, text, **params):
    r = client.post("/basket", json={"text": text, **params})
    assert r.status_code == 200, r.text
    return r.json()


def test_each_line_resolves_to_a_product_or_category_with_quantity_and_unit(client):
    b = basket(client, SCENARIO_B)
    assert [(i["product_id"], i["category"], i["quantity"], i["unit"]) for i in b["items"]] == [
        (CABLE, "سیم و کابل برق ساختمان", 200, "meter"),
        (None, POWER_STRIPS, 1, "piece"),
        (BREAKER, "کلید و فیوز مینیاتوری", 1, "piece"),
    ]
    # the amperes of a breaker are not a quantity
    assert [i["line"] for i in b["items"]] == SCENARIO_B.split("\n")


def test_anchor_scenario_b_two_stops_in_lalehzar_with_per_meter_totals_and_a_category_only_flag(client):
    b = basket(client, SCENARIO_B)
    assert len(b["stops"]) == 2
    assert b["missing"] == []
    first, second = b["stops"]
    assert first["shop_id"] == RAMORA
    assert all("لاله" in s["address"] for s in b["stops"])
    cable, breaker = first["items"]
    assert (cable["item"], cable["per_meter"], cable["price_toman"], cable["total_toman"]) == (0, True, 28000, 28000 * 200)
    assert (breaker["item"], breaker["price_toman"], breaker["total_toman"]) == (2, 185000, 185000)
    assert [(i["item"], i["trust_level"], i["total_toman"]) for i in second["items"]] == [(1, "category_only", None)]
    assert first["total_toman"] == 28000 * 200 + 185000
    assert b["total_toman"] == 28000 * 200 + 185000


def test_missing_items_are_listed_and_the_rest_still_planned(client):
    b = basket(client, "کلید مینیاتوری ۱۶ ۲ عدد\nزززز ناموجود")
    assert b["items"][1]["product_id"] is None and b["items"][1]["category"] is None
    assert b["missing"] == [1]
    assert [s["shop_id"] for s in b["stops"]] == [RAMORA]
    assert b["stops"][0]["items"][0]["total_toman"] == 185000 * 2


def test_the_area_limits_the_stops(client):
    b = basket(client, "کلید مینیاتوری ۱۶", area="شیخ هادی")
    assert b["stops"] == [] and b["missing"] == [0]


def test_optimize_basket_tool_shows_the_basket(agent):
    agent.script(Agent.brief(), Agent.call("optimize_basket", text=SCENARIO_B), "برنامهٔ خرید آماده است.")
    turn = agent.turn(SCENARIO_B)
    assert turn.blocks[0]["block"] == "basket"
    assert len(turn.blocks[0]["stops"]) == 2
