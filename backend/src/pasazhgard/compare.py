"""get_product and compare_products: full product details and a side-by-side compare."""

from pydantic import BaseModel

from pasazhgard.normalize import normalize
from pasazhgard.search import Spec


class Product(BaseModel):
    product_id: str
    title: str
    brand: str | None
    category: str | None
    image_urls: list[str]
    specs: list[Spec]


def get_product(conn, product_id: str) -> Product | None:
    row = conn.execute(
        "SELECT product_id, title, brand, category, image_urls, specs FROM products WHERE product_id = %s", [product_id]
    ).fetchone()
    return row and Product(**row)


class SpecRow(BaseModel):
    """One spec across the compared products; a value is None where a product does not record it."""

    key: str
    values: list[str | None]
    differs: bool


class Column(BaseModel):
    product_id: str
    title: str
    brand: str | None
    image_url: str | None


class ProductCompare(BaseModel):
    products: list[Column]
    specs: list[SpecRow]


def compare_products(conn, product_ids: list[str]) -> ProductCompare | None:
    """None when a product is unknown."""
    products = [get_product(conn, pid) for pid in product_ids]
    if None in products:
        return None
    # a product's first row wins when it repeats a key
    by_key = [{} for _ in products]
    for own, p in zip(by_key, products):
        for s in p.specs:
            own.setdefault(s.key, s.value)
    keys = dict.fromkeys(k for own in by_key for k in own)
    specs = []
    for k in keys:
        values = [own.get(k) for own in by_key]
        specs.append(SpecRow(key=k, values=values, differs=len({v and normalize(v) for v in values}) > 1))
    return ProductCompare(
        products=[
            Column(product_id=p.product_id, title=p.title, brand=p.brand, image_url=next(iter(p.image_urls), None))
            for p in products
        ],
        specs=specs,
    )
