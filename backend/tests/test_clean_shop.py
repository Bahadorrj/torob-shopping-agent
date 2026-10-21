import json

import pytest

from pasazhgard.clean import clean_hours, clean_payment_options, clean_warranty, fast_delivery, parse_address


def day(status, *shifts):
    return {"status": status, "shifts": [{"start_time": f"{s}:00", "end_time": f"{e}:00"} for s, e in shifts]}


def week(**days):
    return json.dumps({k: days.get(k, day("closed", ("00:00", "00:00"))) for k in ["fri", "mon", "sat", "sun", "thu", "tue", "wed"]})


def test_hours_keys_run_sat_to_fri():
    assert list(clean_hours(week())) == ["sat", "sun", "mon", "tue", "wed", "thu", "fri"]


@pytest.mark.parametrize(
    "raw, expected",
    [
        # the second 00:00-00:00 shift is padding
        (day("declared", ("10:00", "16:30"), ("00:00", "00:00")), {"status": "declared", "shifts": [{"start": "10:00", "end": "16:30"}]}),
        # midday break
        (
            day("declared", ("09:30", "13:00"), ("16:00", "20:00")),
            {"status": "declared", "shifts": [{"start": "09:30", "end": "13:00"}, {"start": "16:00", "end": "20:00"}]},
        ),
        (day("closed", ("00:00", "00:00"), ("00:00", "00:00")), {"status": "closed", "shifts": []}),
        # unsupported days carry placeholder shifts such as 08:00-08:00
        (day("unsupported", ("08:00", "08:00")), {"status": "unsupported", "shifts": []}),
    ],
)
def test_hours_day(raw, expected):
    assert clean_hours(week(sat=raw))["sat"] == expected


@pytest.mark.parametrize("raw", ["{}", "null", ""])
def test_shop_without_hours_is_unknown_every_day(raw):
    hours = clean_hours(raw)
    assert list(hours) == ["sat", "sun", "mon", "tue", "wed", "thu", "fri"]
    assert all(d == {"status": "unknown", "shifts": []} for d in hours.values())


@pytest.mark.parametrize(
    "address, pasaj, floor, unit, landmark",
    [
        (
            "سه راه جمهوری، نرسیده به شیخ هادی، نبش کوچه شهریار، پاساژ علاالدین، طبقه ۲، واحد ۲۴۲",
            "علاالدین", "۲", "۲۴۲", "نبش کوچه شهریار",
        ),
        ("خیابان جمهوری اسلامی، خیابان شیخ هادی، پاساژ علاءالدین 2، طبقه 4، پلاک 424", "علاالدین 2", "4", "424", None),
        ("جمهوری اسلامی، ابتدای خیابان شیخ هادی، مجتمع علائدین ۲، طبقه ۶، واحد ۶۰۸ و ۶۰۹", "علاالدین 2", "۶", "۶۰۸ و ۶۰۹", None),
        ("خیابان جمهوری، پاساژعلالدین، طبقه 5، واحد 506", "علاالدین", "5", "506", None),
        ("خیابان لاله زار نو، نرسیده به تقاطع منوچهری، پاساژ درافشان، طبقه پنجم، پلاک 6/27", "درافشان", "پنجم", "6/27", "نرسیده به تقاطع منوچهری"),
        ("خیابان جمهوری اسلامی، تقاطع خیابان حافظ، مجتمع تجاری علاالدین تهران، طبقه زیر همکف، پلاک 18", "علاالدین تهران", "زیر همکف", "18", None),
        # the landmark is the one nearest the shop; a pasaj named in a landmark is not the shop's pasaj
        ("خیابان جمهوری اسلامی، روبروی علالدین، پاساژ حافظ، پلاک ۱", "حافظ", None, "۱", "روبروی علالدین"),
        ("خیابان جمهوری، تقاطع حافظ، روبه‌روی پاساژ چهارسو، نبش مجتمع نادری، پلاک 553", None, None, None, "نبش مجتمع نادری"),
        ("تهران خیابان ملت کوچه کاوه پاساژ کیان طبقه دوم پلاک ۲۲۶", "کیان", "دوم", "۲۲۶", None),
        ("لاله زار جنوبی، پاساز بوشهری، طبقه اول (بالای همکف)، پلاک 59", "بوشهری", "اول (بالای همکف)", "59", None),
        ("خیابان سعدی جنوبی، کوچه مهران، وسط کوچه، پلاک ۱۸، طبقه همکف، واحد ۱", None, "همکف", "۱", None),
        # a street number outside a pasaj or floor is not a unit
        ("بلوار فردوسی، خیابان ملانوروزی، پلاک 36", None, None, None, None),
        ("", None, None, None, None),
    ],
)
def test_parse_address(address, pasaj, floor, unit, landmark):
    assert parse_address(address) == {"pasaj": pasaj, "floor": floor, "unit": unit, "landmark": landmark}


def test_payment_options_keep_provider_and_channel():
    raw = json.dumps(
        [
            {"category_names": [], "channel": "in_person", "max_price_toman": None, "min_price_toman": None, "provider_name": "اسنپ‌پی"},
            {"category_names": [], "channel": "unknown", "max_price_toman": 0, "min_price_toman": 0, "provider_name": "ترب‌پی"},
        ],
        ensure_ascii=False,
    )
    assert clean_payment_options(raw) == [
        {"provider": "اسنپ‌پی", "channel": "in_person"},
        {"provider": "ترب‌پی", "channel": "unknown"},
    ]


@pytest.mark.parametrize("raw", ["[]", "null", ""])
def test_no_payment_options(raw):
    assert clean_payment_options(raw) == []


@pytest.mark.parametrize("raw, expected", [("true", "yes"), ("false", "no"), ("null", "unknown"), ("", "unknown")])
def test_fast_delivery(raw, expected):
    assert fast_delivery(raw) == expected


def warranty(provider=None, months=None, description=None):
    return json.dumps({"description": description, "period_months": months, "provider": provider}, ensure_ascii=False)


@pytest.mark.parametrize(
    "raw, expected",
    [
        ("null", None),
        ("", None),
        (warranty("شرکتی", 18), {"kind": "warranty", "provider": "شرکتی", "months": 18, "description": None}),
        (warranty("تست و تحویل در حضور مشتری"), {"kind": "test_in_presence", "provider": None, "months": None, "description": None}),
        (warranty("بدون گارانتی"), {"kind": "none", "provider": None, "months": None, "description": None}),
        (
            warranty(description="گارانتی اصالت و سلامت فیزیکی کالا"),
            {"kind": "warranty", "provider": None, "months": None, "description": "گارانتی اصالت و سلامت فیزیکی کالا"},
        ),
        # months written only in the description
        (warranty(description="2 سال"), {"kind": "warranty", "provider": None, "months": 24, "description": "2 سال"}),
        (warranty(description="۱۸ ماهه دیباکام"), {"kind": "warranty", "provider": None, "months": 18, "description": "۱۸ ماهه دیباکام"}),
        (
            warranty(description="7 روز مهلت تست و 6 ماه گارانتی"),
            {"kind": "warranty", "provider": None, "months": 6, "description": "7 روز مهلت تست و 6 ماه گارانتی"},
        ),
        # the source writes a missing description as the string "None"
        (warranty(description="None"), None),
    ],
)
def test_clean_warranty(raw, expected):
    assert clean_warranty(raw) == expected
