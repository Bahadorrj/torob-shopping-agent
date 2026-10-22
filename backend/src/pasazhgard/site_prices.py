"""fetch_site_price: the latest price on a seller's own website, read by the small model. It says nothing about stock."""

import datetime as dt
import logging
import os
import re
from typing import Literal, Protocol
from urllib.parse import urlencode, urljoin

import httpx
from langchain_core.messages import HumanMessage, SystemMessage
from pydantic import BaseModel, Field

from pasazhgard.shops import TEHRAN

log = logging.getLogger(__name__)


class WebFetch(Protocol):
    """Port to seller websites: a page's HTML, or an exception on timeout or error."""

    def get(self, url: str) -> str: ...


class HttpFetch:
    """Each site gets its own short timeout, so a slow or blocking site never holds up the flow."""

    def __init__(self, timeout: float = float(os.environ.get("SITE_FETCH_TIMEOUT_SECONDS", "5"))):
        self.client = httpx.Client(timeout=timeout, follow_redirects=True)

    def get(self, url: str) -> str:
        r = self.client.get(url)
        r.raise_for_status()
        return r.text


class SitePrice(BaseModel):
    """A website price: `unavailable` when the site failed, timed out or showed no price; ask the seller instead."""

    shop_id: str
    product_id: str
    status: Literal["found", "unavailable"]
    price_toman: int | None
    trust_level: Literal["website_price"] = "website_price"
    fetched_at: dt.datetime
    url: str


class SitePriceParse(BaseModel):
    """The product's price on a shop's web page. Null when the page does not show this product's price."""

    price_toman: int | None = Field(None, gt=0, description="the product's current price in toman; 1 toman is 10 rial")


class FetchQuery(BaseModel):
    shop_id: str
    product_id: str


def search_url(website: str, title: str) -> str:
    # shortcut: offers carry no product page URL, so this is the WordPress/WooCommerce search most shop sites run;
    # add per-site search paths if many sites use another platform
    return urljoin(website, "/") + "?" + urlencode({"s": title, "post_type": "product"})


def _text(html: str) -> str:
    html = re.sub(r"(?is)<(script|style)\b.*?</\1>", " ", html)
    # shortcut: the first 20k characters of visible text; a long listing may push the product past it
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", html)).strip()[:20_000]


def _parse(model, title: str, page: str) -> int | None:
    prompt = (
        "You read an Iranian shop's web page. Give the current price of this product, in toman, "
        f"only when the page shows a price for it: {title}"
    )
    structured = model.with_structured_output(SitePriceParse, method="json_schema")
    return structured.invoke([SystemMessage(prompt), HumanMessage(_text(page))]).price_toman


def fetch_site_price(conn, sid: str, q: FetchQuery, web: WebFetch, model, now: dt.datetime) -> SitePrice | None:
    """Fetch and keep the session's website price for a shop and product. Any failure is `unavailable`.

    None when the session, shop or product does not exist; ValueError when the shop has no website.
    """
    if conn.execute("SELECT 1 FROM sessions WHERE session_id = %s", [sid]).fetchone() is None:
        return None
    shop = conn.execute("SELECT website_url FROM shops WHERE shop_id = %s", [q.shop_id]).fetchone()
    product = conn.execute("SELECT title FROM products WHERE product_id = %s", [q.product_id]).fetchone()
    if shop is None or product is None:
        return None
    if not shop["website_url"]:
        raise ValueError(f"{q.shop_id} has no website")
    url = search_url(shop["website_url"], product["title"])
    price = None
    try:
        if model is not None:
            price = _parse(model, product["title"], web.get(url))
    except Exception:
        log.warning("site price fetch failed for %s", url, exc_info=True)
    result = SitePrice(
        shop_id=q.shop_id, product_id=q.product_id, status="found" if price else "unavailable", price_toman=price, fetched_at=now, url=url
    )
    conn.execute(
        """
        INSERT INTO site_prices (session_id, shop_id, product_id, status, price_toman, fetched_at, url)
        VALUES (%s, %s, %s, %s, %s, %s, %s)
        ON CONFLICT (session_id, shop_id, product_id) DO UPDATE
        SET status = excluded.status, price_toman = excluded.price_toman, fetched_at = excluded.fetched_at, url = excluded.url
        """,
        [sid, *result.model_dump(include={"shop_id", "product_id", "status", "price_toman", "fetched_at", "url"}).values()],
    )
    return result


def site_prices(conn, sid: str, product_id: str | None = None) -> list[SitePrice]:
    """The session's website prices, oldest fetch first, optionally for one product."""
    rows = conn.execute(
        "SELECT * FROM site_prices WHERE session_id = %s AND (%s::text IS NULL OR product_id = %s) ORDER BY fetched_at, shop_id",
        [sid, product_id, product_id],
    ).fetchall()
    # Tehran time, as the UI shows the time of day from the ISO string
    return [SitePrice(**(r | {"fetched_at": r["fetched_at"].astimezone(TEHRAN)})) for r in rows]
