import pytest

from pasazhgard.normalize import normalize


@pytest.mark.parametrize(
    "raw, expected",
    [
        ("کليد اتوماتيک", "کلید اتوماتیک"),  # Arabic yeh
        ("كابل", "کابل"),  # Arabic kaf
        ("هدفون بی‌سیم", "هدفون بی سیم"),  # ZWNJ
        ("هدفون  بی \t سیم ", "هدفون بی سیم"),  # runs of spaces, tab, nbsp
        ("ایرپاد پرو ۲", "ایرپاد پرو 2"),  # Persian digits
        ("پنل ١٠ شاسی", "پنل 10 شاسی"),  # Arabic digits
        ("اَنکر", "انکر"),  # diacritics
        ("علاءالدین", "علاالدین"),  # hamza
        ("أ إ ؤ ئ آ", "ا ا و ی ا"),  # hamza carriers
        ("ANKER Soundcore", "anker soundcore"),  # Latin case
        ("", ""),
    ],
)
def test_normalize(raw, expected):
    assert normalize(raw) == expected
