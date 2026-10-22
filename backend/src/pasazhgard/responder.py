"""Seller auto-responder for unattended demos: a second consumer of the Seller Console channel that plays the seller."""

import datetime as dt
import logging
import os
import random

from langchain_core.messages import HumanMessage, SystemMessage
from pydantic import BaseModel, Field

from pasazhgard.inquiries import ConsoleReply, SellerConsole, _inquiry, _tick, record_reply

log = logging.getLogger(__name__)


class Responder(BaseModel):
    """The simulated sellers' behaviour; one seed makes every demo run reply the same way."""

    seed: int = 0
    out_of_stock: float = Field(0.2, ge=0, le=1)
    no_reply: float = Field(0.2, ge=0, le=1)
    # of the sellers in stock, how many quote a price other than the listing
    price_change: float = Field(0.3, ge=0, le=1)


def responder_from_env() -> Responder | None:
    """None unless AUTO_RESPONDER_ENABLED is true; the seed and rates come from AUTO_RESPONDER_* variables."""
    if os.environ.get("AUTO_RESPONDER_ENABLED", "").lower() not in ("1", "true"):
        return None
    env = {k: os.environ[f"AUTO_RESPONDER_{k.upper()}"] for k in Responder.model_fields if f"AUTO_RESPONDER_{k.upper()}" in os.environ}
    return Responder(**env)


def decide(config: Responder, inquiry_id: int, listed_price: int | None) -> ConsoleReply | None:
    """What the seller of this inquiry says, as quick replies; None for a seller who never answers."""
    # seeded per inquiry, so a reply does not depend on which other inquiries were answered first
    rng = random.Random(f"{config.seed}:{inquiry_id}")
    if rng.random() < config.no_reply:
        return None
    if rng.random() < config.out_of_stock:
        return ConsoleReply(available="no")
    price = listed_price
    if price and rng.random() < config.price_change:
        price = round(price * (1 + rng.choice([-1, 1]) * rng.uniform(0.03, 0.1)), -3)
    return ConsoleReply(available="yes", latest_price_toman=price)


def _role_play(model, message: str, facts: ConsoleReply) -> str:
    said = "it is out of stock" if facts.available == "no" else "it is in stock"
    if facts.latest_price_toman:
        said += f", today's price is {facts.latest_price_toman} toman"
    prompt = (
        "You play a shop seller in a Tehran market replying to a buyer's message on a demo console. "
        f"Reply in one or two short, casual Persian sentences saying {said}. Say nothing else as fact."
    )
    return model.invoke([SystemMessage(prompt), HumanMessage(message)]).content


def respond(conn, config: Responder, now: dt.datetime, chat=None, small=None) -> None:
    """One pass: every inquiry waiting on the Seller Console gets its seller's reply, through `record_reply`.

    With `chat` the seller writes free text that `small` parses, as a console reply would be; without it, or when the
    role-play call fails, the seller taps quick replies.
    """
    _tick(conn, now)
    rows = conn.execute(
        """
        SELECT i.*, o.price_toman FROM inquiries i LEFT JOIN offers o USING (offer_id)
        WHERE i.status = 'sent' AND i.channel = %s ORDER BY i.inquiry_id
        """,
        [SellerConsole.name],
    ).fetchall()
    for row in rows:
        facts = decide(config, row["inquiry_id"], row.pop("price_toman"))
        if facts is None:
            continue
        body = facts
        if chat:
            try:
                body = ConsoleReply(text=_role_play(chat, _inquiry(row).message, facts))
            except Exception:
                log.warning("auto-responder role-play failed, sending quick replies", exc_info=True)
        try:
            record_reply(conn, row["inquiry_id"], body, now, small, auto=True)
            conn.commit()
        except (LookupError, ValueError):
            # a person on the console moved it first
            conn.rollback()
