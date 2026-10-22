"""get_product and compare_products: full product details and a side-by-side compare."""

from pydantic import BaseModel

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
