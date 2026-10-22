from datetime import UTC, datetime

import pytest

from pasazhgard.clean import add_brand_aliases, clean_offer, clean_product, flag_far_from_median


def offer_row(**kw):
    row = {
        "description": "",
        "last_price_changed_at": "2026-09-14T08:57:27.401253+00:00",
        "offer_id": "offer_1",
        "price_toman": "610000",
        "product_id": "product_1",
        "seller_title": "هدفون",
        "shop_id": "shop_1",
        "warranty": "null",
    }
    return row | kw


def test_clean_offer_record():
    assert clean_offer(offer_row()) == {
        "offer_id": "offer_1",
        "product_id": "product_1",
        "shop_id": "shop_1",
        "seller_title": "هدفون",
        "price_toman": 610000,
        "last_price_changed_at": datetime(2026, 9, 14, 8, 57, 27, 401253, tzinfo=UTC),
        "price_flags": [],
        "warranty": None,
    }


def test_clean_offer_without_change_date():
    assert clean_offer(offer_row(last_price_changed_at="null"))["last_price_changed_at"] is None


@pytest.mark.parametrize(
    "price, flags",
    [
        ("null", ["missing"]),
        ("", ["missing"]),
        ("1", ["placeholder"]),
        ("999", ["placeholder"]),
        ("1000", []),
        ("10000000000", []),
        ("10000000001", ["invalid"]),
        ("155000175000", ["invalid"]),
    ],
)
def test_price_flags(price, flags):
    assert clean_offer(offer_row(price_toman=price))["price_flags"] == flags


@pytest.mark.parametrize(
    "seller_title, per_meter",
    [
        ("کابل برق افشان 4*4 کرمان کابل رادین متری", True),
        ("کابل افشان 4در16 زرتافته کرمان(متری)", True),
        ("سیم مسی لخت - سایزهای 16 تا 300 - (سایز 70 قیمت متری)", True),
        ("کابل افشان ۱۰×۲نیکو رسا فروش هر متر", True),
        ("کابل ابزار دقیق 1.5*2*2 بدون زره به صورت متری و قرقره", True),
        ("یک متر کابل مخابراتی چهار زوج 0.6 برند خراسان (فروش به صورت حلقه 100 متری)", True),
        ("محافظ یخچال با کابل 1.8متری کد 767", False),
        ("کابل ترکیبی زیمنس RG59 تمام مس ۳۰۵ متری", False),
        ("پچ کورد کابل شبکه CAT6 لگراند 30 سانتی متری", False),
        ("ساعت هوشمند 46 میلی‌متری اپل", False),
        ("ریسه نئون قرمز یک متری 12 ولت", True),
        ("سیم برق افشان 16*1 زرتافته کرمان 1 متری", True),
        ("کابل افشان خراسان 4*10 متری", True),
        ("کابل افشان ۲ در ۱.۵ متری", True),
        ("سیم افشان 0.75 کرمان کابل ابهر کلاف 100 متری", False),
        ("کابل شبکه 11 متری", False),
        ("کابل HDMI دو متری", False),
        ("وال واشر LED ۳۰۰سانتی‌متری", False),
        ("نئون فلکسی پرتغالی (یک متری)", True),
        ("گلند پلاستیکی کابل متریک سایز M40", False),
        ("اسپیرومتری تشویقی 3 توپ", False),
        ("کابل شارژ تایپ سی 1 متری", False),
        ("کابل HDMI یک متری", False),
        ("فرش 2 در 3 متری", False),
        ("ریل مینیاتوری 1 متری", False),
        ("کابل شارژ هادرون مدل C به C یک متر 3 آمپر", False),
        ("یک متر", True),
        ("ریسه وایرلس مدل ۲۸۳۵ لیان نور(برش یک متر)", True),
        ("کابل افشان مسی 5 در 16 افشار نژاد خراسان (یک متر)", True),
        ("کابل زمینی 5 در 16 متری افشار نژاد خراسان", True),
    ],
)
def test_per_meter_from_seller_title(seller_title, per_meter):
    flags = clean_offer(offer_row(seller_title=seller_title))["price_flags"]
    assert ("per_meter" in flags) is per_meter


def test_per_meter_with_missing_price():
    flags = clean_offer(offer_row(seller_title="کابل افشان (متری)", price_toman="null"))["price_flags"]
    assert flags == ["missing", "per_meter"]


def test_far_from_median_uses_valid_offers_of_same_product_and_unit():
    rows = [
        ("a", "p1", "3000000", "هدفون"),
        ("b", "p1", "3200000", "هدفون"),
        ("c", "p1", "3400000", "هدفون"),
        ("d", "p1", "22950000", "هدفون"),  # > 2x median
        ("e", "p1", "1500000", "هدفون"),  # < 0.5x median (3200000)
        ("f", "p1", "700", "هدفون"),  # placeholder: not in the median, not flagged far
        ("g", "p1", "null", "هدفون"),
        ("h", "p1", "45000", "کابل (متری)"),  # alone in its unit group
        ("i", "p2", "100", "x"),
    ]
    offers = [clean_offer(offer_row(offer_id=o, product_id=p, price_toman=price, seller_title=t)) for o, p, price, t in rows]
    flag_far_from_median(offers)
    far = {o["offer_id"] for o in offers if "far_from_median" in o["price_flags"]}
    assert far == {"d", "e"}


def test_far_from_median_needs_three_valid_prices():
    rows = [("a", "1000000"), ("b", "5000000"), ("c", "700")]
    offers = [clean_offer(offer_row(offer_id=o, price_toman=price)) for o, price in rows]
    flag_far_from_median(offers)
    assert not any("far_from_median" in o["price_flags"] for o in offers)


def product_row(**kw):
    row = {
        "brand_name": "انکر",
        "category_name": "هدفون، هدست و هندزفری",
        "image_urls": '["https://image.torob.com/a.jpg","https://image.torob.com/b.jpg"]',
        "model": "null",
        "persian_title": "هدفون بی‌سیم اَنکر مدل Soundcore R50i",
        "product_id": "product_1",
        "specs": '[{"key":"نوع اتصال","section":"مشخصات کلی","value":"بی سیم"},'
        '{"key":"رنگ","section":"ظاهر","value":"مشکی"}]',
    }
    return row | kw


def test_clean_product_record():
    assert clean_product(product_row()) == {
        "product_id": "product_1",
        "title": "هدفون بی‌سیم اَنکر مدل Soundcore R50i",
        "brand": "انکر",
        "category": "هدفون، هدست و هندزفری",
        "model": None,
        "image_urls": ["https://image.torob.com/a.jpg", "https://image.torob.com/b.jpg"],
        "specs": [{"key": "نوع اتصال", "value": "بی سیم"}, {"key": "رنگ", "value": "مشکی"}],
        "search_text": "هدفون بی سیم انکر مدل soundcore r50i انکر",
        "brand_terms": ["انکر"],
    }


@pytest.mark.parametrize("empty", ["null", "", "[]"])
def test_clean_product_without_specs_or_images(empty):
    p = clean_product(product_row(specs=empty, image_urls=empty, brand_name="null"))
    assert (p["specs"], p["image_urls"], p["brand"]) == ([], [], None)
    assert p["search_text"] == "هدفون بی سیم انکر مدل soundcore r50i"


def aliases(rows: list[tuple[str, str]]) -> dict[str, set[str]]:
    """Brand aliases from (brand, brand spec value) rows, one product per row."""
    products = [
        {"brand": brand, "specs": [{"key": "برند", "value": value}], "search_text": "", "brand_terms": []}
        for brand, value in rows
    ]
    add_brand_aliases(products)
    return {p["brand"]: set(p["brand_terms"]) for p in products}


@pytest.mark.parametrize(
    "rows, expected",
    [
        # the brand's own Latin name, also when some products add a generic word
        (
            [("انکر", "Anker")] * 3 + [("انکر", "Anker Brand"), ("ای دیتا", "ADATA Brand"), ("رپو", "Rapoo brand")],
            {"انکر": {"anker"}, "ای دیتا": {"adata"}, "رپو": {"rapoo"}},
        ),
        (
            [("شیائومی", "Xiaomi")] * 3 + [("شیائومی", "Mi"), ("کیو سی وای", "QCY Xiaomi")],
            {"شیائومی": {"xiaomi"}, "کیو سی وای": {"qcy"}},
        ),
        # lens makers listed under the camera brand they fit
        ([("سونی", "Sony")] * 3 + [("سونی", "Sigma"), ("سونی", "Tamron"), ("سیگما", "Sigma")], {"سونی": {"sony"}, "سیگما": set()}),
        # case and accessory makers listed under phone brands
        (
            [("سامسونگ", "Samsung")] * 3
            + [("سامسونگ", "Nillkin"), ("سامسونگ", "Dux Ducis"), ("سامسونگ", "Mitsubishi")]
            + [("اپل", "Apple")] * 2
            + [("اپل", "Dux Ducis"), ("اپل", "Apple Design")],
            {"سامسونگ": {"samsung"}, "اپل": {"apple"}},
        ),
        # Kia parts listed under Hyundai
        (
            [("هیوندای", "Hyundai")] * 2 + [("هیوندای", "Hyundai Parts"), ("هیوندای", "Kia Parts"), ("کیا", "Kia"), ("کیا", "Kia Parts")],
            {"هیوندای": {"hyundai"}, "کیا": {"kia"}},
        ),
        # a generic word several brands use names none of them
        ([("ژیون", "Geeon Tech"), ("ای فورتک", "A4 Tech"), ("اپل", "Tech")], {"ژیون": {"geeon"}, "ای فورتک": set(), "اپل": set()}),
    ],
)
def test_brand_aliases_name_only_the_brand_itself(rows, expected):
    assert aliases(rows) == expected
