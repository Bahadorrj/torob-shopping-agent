"""Persian text normalization for matching. Display text is never normalized."""

import re

_TABLE = str.maketrans(
    {
        "ي": "ی",  # Arabic yeh -> Persian yeh
        "ى": "ی",  # alef maksura -> Persian yeh
        "ك": "ک",  # Arabic kaf -> Persian kaf
        "أ": "ا",  # alef with hamza above -> alef
        "إ": "ا",  # alef with hamza below -> alef
        "آ": "ا",  # alef with madda -> alef
        "ٱ": "ا",  # alef wasla -> alef
        "ؤ": "و",  # waw with hamza -> waw
        "ئ": "ی",  # yeh with hamza -> yeh
        "ۀ": "ه",  # heh with yeh above -> heh
        "ة": "ه",  # teh marbuta -> heh
        "ء": None,  # lone hamza
        "ـ": None,  # tatweel
        **{chr(c): None for c in range(0x064B, 0x0660)},  # harakat, hamza above/below marks
        "ٰ": None,  # superscript alef
        **{chr(0x06F0 + d): str(d) for d in range(10)},  # Persian digits
        **{chr(0x0660 + d): str(d) for d in range(10)},  # Arabic digits
    }
)

# ZWNJ, ZWJ, bidi marks and other invisible separators all become a space
_SPACES = re.compile(r"[\s​-‏‪-‮⁦-⁩﻿]+")


def normalize(text: str) -> str:
    return _SPACES.sub(" ", text.translate(_TABLE)).strip().lower()


def distinct(ids: list) -> list:
    """Pydantic validator for an id list: the same id twice is one pick, not two."""
    if len(set(ids)) != len(ids):
        raise ValueError("an id repeats")
    return ids
