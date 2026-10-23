"""Seller Liaison outside the graph (ADR-0002): the inquiry store, its state machine and the seller channel port."""

import datetime as dt
import hashlib
import hmac
import logging
import os
from textwrap import dedent
from typing import Annotated, Literal, Protocol, Self

from langchain_core.messages import HumanMessage, SystemMessage
from psycopg.types.json import Jsonb
from pydantic import AfterValidator, BaseModel, ConfigDict, Field, model_validator

from pasazhgard.normalize import distinct
from pasazhgard.shops import open_at
from pasazhgard.site_prices import SitePrice, site_prices

log = logging.getLogger(__name__)

# closed: the shop was closed when the user consented; queued: it goes out when the shop opens
Status = Literal["draft", "closed", "queued", "sent", "replied", "confirmed", "unavailable", "no_reply"]
# an inquiry still sent, or replied without saying whether it is in stock, this long after its last step turns no_reply
NO_REPLY_AFTER = dt.timedelta(minutes=float(os.environ.get("NO_REPLY_MINUTES", "2")))
Question = Literal["available", "price", "hold", "installments"]


class Reply(BaseModel):
    """A seller reply in the parsed shape; the inquiry keeps the merge of every reply."""

    available: Literal["yes", "no", "unknown"] = "unknown"
    latest_price_toman: int | None = None
    hold_until: dt.time | None = None
    installments: bool | None = None
    notes: str | None = None
    confidence: float | None = None


class Event(BaseModel):
    """One step of the timeline: the status after it and, for a seller reply, what the seller sent."""

    at: dt.datetime
    status: Status
    reply: dict | None = None
    # the Seller Liaison's one follow-up question to the seller, after an ambiguous free-text reply
    question: str | None = None


class Inquiry(BaseModel):
    inquiry_id: int
    # None when the shop does not list the item and is asked anyway
    offer_id: str | None
    product_id: str
    product_title: str
    shop_id: str
    shop_name: str
    status: Status
    message: str
    # the seller channel it went through; None while a draft
    channel: str | None
    # replies through the Seller Console come from a person playing the seller
    simulated: bool
    reply: Reply
    events: list[Event]
    # an alternative asked in place of this inquiry of the session
    instead_of: int | None = None


class InquiryStatus(BaseModel):
    """The `inquiry_status` block: a session's inquiries, oldest first, and the website prices it fetched."""

    inquiries: list[Inquiry]
    site_prices: list[SitePrice] = []


class Outcome(BaseModel):
    """A shop's latest sent inquiry as seller lists and compares use it."""

    inquiry_id: int
    status: Status
    # "yes" only from a seller, so always with `replied_at`
    available: Literal["yes", "no", "unknown"]
    latest_price_toman: int | None
    hold_until: dt.time | None
    installments: bool | None
    # the seller's last reply
    replied_at: dt.datetime | None


class LatestPrice(BaseModel):
    """A price newer than the listing: one a seller confirmed in an inquiry, else one read from the seller's website."""

    status: Literal["not_asked", "asked", "website", "confirmed"] = "not_asked"
    price_toman: int | None = None
    trust_level: Literal["confirmed", "website_price", "unknown"] = "unknown"
    at: dt.datetime | None = None


def latest_price(o: Outcome | None, site: SitePrice | None = None) -> LatestPrice:
    if o is not None and o.latest_price_toman is not None:
        return LatestPrice(status="confirmed", price_toman=o.latest_price_toman, trust_level="confirmed", at=o.replied_at)
    if site is not None and site.status == "found":
        return LatestPrice(status="website", price_toman=site.price_toman, trust_level="website_price", at=site.fetched_at)
    return LatestPrice(status="not_asked" if o is None else "asked")


def sites(conn, sid: str, product_id: str) -> dict[str, SitePrice]:
    """The session's website price per shop for one item."""
    return {p.shop_id: p for p in site_prices(conn, sid, product_id)}


def outcomes(conn, sid: str, product_id: str, now: dt.datetime) -> dict[str, Outcome]:
    """The latest sent inquiry per shop for one item of a session."""
    _tick(conn, now)
    rows = conn.execute(
        "SELECT * FROM inquiries WHERE session_id = %s AND product_id = %s AND status <> 'draft' ORDER BY inquiry_id", [sid, product_id]
    ).fetchall()
    return {i.shop_id: outcome(i) for i in map(_inquiry, rows)}


def outcome(i: Inquiry) -> Outcome:
    replied = next((e.at for e in reversed(i.events) if e.reply), None)
    return Outcome(inquiry_id=i.inquiry_id, status=i.status, **i.reply.model_dump(exclude={"notes", "confidence"}), replied_at=replied)


class Ask(BaseModel):
    """A shop that does not list the item, asked about it anyway."""

    model_config = ConfigDict(frozen=True)

    product_id: str
    shop_id: str


class Compose(BaseModel):
    """1-3 sellers: offers, or shops to ask about an item they do not list."""

    offer_ids: Annotated[list[str], AfterValidator(distinct)] = []
    asks: Annotated[list[Ask], AfterValidator(distinct)] = []
    questions: Annotated[list[Question], AfterValidator(distinct)] = ["available", "price", "hold", "installments"]
    # the inquiry that fell through, when this one asks an alternative; it takes that stop in the visit plan
    instead_of: int | None = None

    @model_validator(mode="after")
    def _one_to_three(self) -> Self:
        sellers = len(self.offer_ids) + len(self.asks)
        if not 1 <= sellers <= 3:
            raise ValueError("ask 1 to 3 sellers")
        if self.instead_of is not None and sellers != 1:
            raise ValueError("one alternative stands in for one inquiry")
        return self


def _fa(s: str) -> str:
    return s.translate(str.maketrans("0123456789", "۰۱۲۳۴۵۶۷۸۹"))


def _message(title: str, questions: list[Question], hold: dt.time | None) -> str:
    asks = {
        "available": "الان موجود است؟",
        "price": "قیمت امروزش چند است؟",
        "hold": f"تا ساعت {_fa(hold.strftime('%H:%M'))} برایم نگه می‌دارید؟" if hold else "می‌توانید چند ساعت برایم نگه دارید؟",
        "installments": "اقساط یا ترب‌پی قبول می‌کنید؟",
    }
    return " ".join([f"سلام، وقت بخیر. درباره «{title}» سؤال داشتم:", *(asks[q] for q in questions), "ممنون."])


def _inquiry(row: dict) -> Inquiry:
    return Inquiry(**row, simulated=row["channel"] == SellerConsole.name)


def _tick(conn, now: dt.datetime) -> None:
    """The moves the clock makes, applied on every read: queued -> sent once the shop opens, sent or replied -> no_reply after N."""
    # shortcut: scans every waiting inquiry on each read; move to a scheduler if the table grows
    for row in conn.execute(
        "SELECT i.*, s.hours FROM inquiries i LEFT JOIN shops s USING (shop_id) WHERE i.status IN ('queued', 'sent', 'replied')"
    ).fetchall():
        i = _inquiry(row)
        if i.status == "queued" and row["hours"] and open_at(row["hours"], now):
            # shortcut: the Seller Console needs no send call; a channel that does needs a sender job here
            _move(conn, i, "sent", now, channel=SellerConsole.name)
        elif i.status in ("sent", "replied"):
            due = i.events[-1].at + NO_REPLY_AFTER
            if due <= now:
                _move(conn, i, "no_reply", due)


def get_inquiries(conn, sid: str, now: dt.datetime) -> InquiryStatus | None:
    """None when the session does not exist."""
    if conn.execute("SELECT 1 FROM sessions WHERE session_id = %s", [sid]).fetchone() is None:
        return None
    _tick(conn, now)
    rows = conn.execute("SELECT * FROM inquiries WHERE session_id = %s ORDER BY inquiry_id", [sid]).fetchall()
    return InquiryStatus(inquiries=[_inquiry(r) for r in rows], site_prices=site_prices(conn, sid))


def _open(conn, sid: str, product_id: str) -> int:
    """How many of the session's inquiries about the item are open; at most 3 may be."""
    return conn.execute(
        "SELECT count(*) AS n FROM inquiries WHERE session_id = %s AND product_id = %s AND status IN ('queued', 'sent', 'replied')",
        [sid, product_id],
    ).fetchone()["n"]


def contact_seller(conn, sid: str, change: Compose, now: dt.datetime) -> InquiryStatus | None:
    """Compose one draft per offer. Nothing is sent: `confirm_inquiries` sends after the user consents.

    None when the session does not exist; LookupError for an unknown offer; ValueError when an item would have
    more than 3 open inquiries.
    """
    brief = conn.execute("SELECT brief FROM sessions WHERE session_id = %s", [sid]).fetchone()
    if brief is None:
        return None
    hold = brief["brief"]["visit_window"]["earliest_arrival"]
    offers = conn.execute(
        """
        SELECT o.offer_id, o.product_id, p.title AS product_title, o.shop_id, s.name AS shop_name
        FROM offers o JOIN products p USING (product_id) JOIN shops s USING (shop_id)
        WHERE o.offer_id = ANY(%s)
        """,
        [change.offer_ids],
    ).fetchall()
    if len(offers) != len(change.offer_ids):
        raise LookupError(change.offer_ids)
    asks = [
        conn.execute(
            """
            SELECT NULL AS offer_id, p.product_id, p.title AS product_title, s.shop_id, s.name AS shop_name
            FROM products p, shops s WHERE p.product_id = %s AND s.shop_id = %s
            """,
            [a.product_id, a.shop_id],
        ).fetchone()
        for a in change.asks
    ]
    if None in asks:
        raise LookupError(change.asks)
    if change.instead_of is not None and not conn.execute(
        "SELECT 1 FROM inquiries WHERE inquiry_id = %s AND session_id = %s", [change.instead_of, sid]
    ).fetchone():
        raise LookupError(change.instead_of)
    by_id = {o["offer_id"]: o for o in offers}
    targets = [by_id[oid] for oid in change.offer_ids] + asks
    products = [o["product_id"] for o in targets]
    # a new compose replaces the item's unsent drafts
    conn.execute("DELETE FROM inquiries WHERE session_id = %s AND status = 'draft' AND product_id = ANY(%s)", [sid, products])
    for p in set(products):
        if (open_ := _open(conn, sid, p)) + products.count(p) > 3:
            raise ValueError(f"{p} has {open_} open inquiries")
    drafts = []
    for o in targets:
        message = _message(o["product_title"], change.questions, hold and dt.time.fromisoformat(hold))
        drafts.append(
            conn.execute(
                """
                INSERT INTO inquiries (session_id, offer_id, product_id, product_title, shop_id, shop_name, status, message, reply, events, instead_of)
                VALUES (%s, %s, %s, %s, %s, %s, 'draft', %s, %s, %s, %s) RETURNING *
                """,
                [sid, o["offer_id"], o["product_id"], o["product_title"], o["shop_id"], o["shop_name"], message, Jsonb(Reply().model_dump()),
                 Jsonb([Event(at=now, status="draft").model_dump(mode="json")]), change.instead_of],
            ).fetchone()
        )
    return InquiryStatus(inquiries=[_inquiry(r) for r in drafts])


class Confirm(BaseModel):
    inquiry_ids: Annotated[list[int], Field(min_length=1, max_length=3), AfterValidator(distinct)]
    # a shop closed now gets the message when it opens, instead of not at all
    queue: bool = False


def _move(conn, inquiry: Inquiry, to: Status, now: dt.datetime, **changes) -> None:
    """The one place a status changes; the timeline gets the step. Raises ValueError for a move the machine does not allow."""
    replied = {"replied", "confirmed", "unavailable"}
    # a seller may correct an earlier reply, and may still answer after no_reply
    allowed = {
        "draft": {"sent", "closed", "queued"},
        "closed": {"sent", "queued"},
        "queued": {"sent"},
        "sent": replied | {"no_reply"},
        "no_reply": replied,
        **dict.fromkeys(replied, replied),
        # a reply that leaves availability unknown still times out
        "replied": replied | {"no_reply"},
    }
    if to not in allowed[inquiry.status]:
        raise ValueError(f"{inquiry.status} -> {to}")
    events = [*inquiry.events, Event(at=now, status=to, reply=changes.pop("event_reply", None), question=changes.pop("event_question", None))]
    sets = ", ".join(f"{k} = %s" for k in changes)
    # only from the status the caller read, so two readers ticking the same inquiry move it once
    conn.execute(
        f"UPDATE inquiries SET status = %s, events = %s{', ' + sets if sets else ''} WHERE inquiry_id = %s AND status = %s",
        [to, Jsonb([e.model_dump(mode="json") for e in events]), *changes.values(), inquiry.inquiry_id, inquiry.status],
    )


def confirm_inquiries(conn, sid: str, change: Confirm, channel: "SellerChannel", now: dt.datetime) -> InquiryStatus | None:
    """The user's consent: send these drafts through the channel. Already sent ones stay as they are.

    The shop's hours are checked first: a shop closed now is not sent to, its inquiry turns `closed`, or `queued` with
    `change.queue`. Unknown hours are not closed.

    None when the session does not exist; LookupError for an inquiry of another session; ValueError when an item
    would have more than 3 open inquiries.
    """
    status = get_inquiries(conn, sid, now)
    if status is None:
        return None
    mine = {i.inquiry_id: i for i in status.inquiries}
    if missing := set(change.inquiry_ids) - set(mine):
        raise LookupError(missing)
    hours = {
        r["shop_id"]: r["hours"]
        for r in conn.execute("SELECT shop_id, hours FROM shops WHERE shop_id = ANY(%s)", [[i.shop_id for i in mine.values()]])
    }
    for iid in change.inquiry_ids:
        i = mine[iid]
        if i.status not in ("draft", "closed"):
            continue
        closed = i.shop_id in hours and open_at(hours[i.shop_id], now) is False
        if closed and not change.queue:
            if i.status == "draft":
                _move(conn, i, "closed", now)
            continue
        # a closed inquiry was not open when composed, so the cap is checked again on the way out
        if _open(conn, sid, i.product_id) >= 3:
            raise ValueError(f"{i.product_id} has 3 open inquiries")
        if closed:
            _move(conn, i, "queued", now)
            continue
        channel.send(conn, i)
        _move(conn, i, "sent", now, channel=channel.name)
    return get_inquiries(conn, sid, now)


class SellerChannel(Protocol):
    """Port to the seller. Replies come back through `record_reply`, whatever the channel."""

    name: str

    def send(self, conn, inquiry: Inquiry) -> None: ...


class SellerConsole:
    """Demo channel: the shop's Seller Console page reads its sent inquiries from the store, so sending is addressing."""

    name = "seller_console"

    def send(self, conn, inquiry: Inquiry) -> None:
        pass


def console_token(secret: str, shop_id: str) -> str:
    """The shop's Seller Console token: derived, never stored, so no buyer-facing row can carry it."""
    return hmac.new(secret.encode(), shop_id.encode(), hashlib.sha256).hexdigest()[:32]


class ConsoleInbox(BaseModel):
    shop_id: str
    shop_name: str
    inquiries: list[Inquiry]


def console_inbox(conn, shop_id: str, now: dt.datetime) -> ConsoleInbox | None:
    """A shop's inquiries sent through the Seller Console, newest first. None for an unknown shop."""
    shop = conn.execute("SELECT name FROM shops WHERE shop_id = %s", [shop_id]).fetchone()
    if shop is None:
        return None
    _tick(conn, now)
    rows = conn.execute(
        "SELECT * FROM inquiries WHERE shop_id = %s AND channel = %s ORDER BY inquiry_id DESC", [shop_id, SellerConsole.name]
    ).fetchall()
    return ConsoleInbox(shop_id=shop_id, shop_name=shop["name"], inquiries=[_inquiry(r) for r in rows])


class ConsoleReply(BaseModel):
    """What the seller sends from the Seller Console: a quick reply sets one parsed field, free text goes in `text`."""

    available: Literal["yes", "no"] | None = None
    latest_price_toman: int | None = Field(None, gt=0)
    hold_until: dt.time | None = None
    installments: bool | None = None
    text: str | None = Field(None, min_length=1, max_length=1000)

    @model_validator(mode="after")
    def _something(self) -> Self:
        if not self.model_fields_set:
            raise ValueError("empty reply")
        return self


class ReplyParse(BaseModel):
    """What a seller's free-text reply says. Leave a field null when the reply does not say it."""

    available: Literal["yes", "no", "unknown"] = Field("unknown", description="whether the item is in stock now")
    latest_price_toman: int | None = Field(None, gt=0, description="today's price in toman")
    hold_until: dt.time | None = Field(None, description="the local time the seller holds the item until")
    installments: bool | None = Field(None, description="whether the seller takes installments or Torob Pay")
    notes: str | None = Field(None, description="anything else the buyer should know, short Persian")
    confidence: float = Field(ge=0, le=1, description="how sure this parse is")
    follow_up: str | None = Field(
        None, description="one short polite Persian question to the seller when the reply leaves availability or price unclear"
    )


def _parse(model, inquiry: Inquiry, text: str) -> ReplyParse:
    asked = next((f"Then you asked: {e.question}" for e in reversed(inquiry.events) if e.question), "")
    prompt = dedent(
        """\
        You read a seller's free-text answer to a buyer's inquiry in Tehran. Times are local (Asia/Tehran);
        "5 عصر" is 17:00. Prices are in toman; "3 میلیون و 400" is 3400000.
        The buyer asked: {message}
        {asked}"""
    )
    structured = model.with_structured_output(ReplyParse, method="json_schema")
    return structured.invoke([SystemMessage(prompt.format(message=inquiry.message, asked=asked)), HumanMessage(text)])


def record_reply(conn, inquiry_id: int, body: ConsoleReply, now: dt.datetime, model=None, auto: bool = False) -> Inquiry:
    """Merge a seller reply into the inquiry. LookupError for an unknown inquiry, ValueError for one not sent yet.

    Free text is parsed by `model` (the small chat model); an ambiguous one gets one follow-up question per inquiry.
    Without a model free text is kept as-is and leaves the parse alone. `auto` marks a reply from the auto-responder.
    """
    def read(lock: str = "") -> Inquiry:
        row = conn.execute(f"SELECT * FROM inquiries WHERE inquiry_id = %s {lock}", [inquiry_id]).fetchone()
        if row is None:
            raise LookupError(inquiry_id)
        return _inquiry(row)

    parse = None
    if body.text and model:
        # the model call takes up to a minute: hold no row lock, or every read that ticks this inquiry waits
        unlocked = read()
        try:
            parse = _parse(model, unlocked, body.text)
        except Exception:
            # the seller's words must not be lost: keep them unparsed, as without a model
            log.warning("seller reply parse failed, keeping the text unparsed", exc_info=True)
    inquiry = read("FOR UPDATE")
    update = body.model_dump(exclude_none=True, exclude={"text"})
    update |= {"confidence": 1.0} if update else {}
    question = None
    if parse:
        update |= {k: v for k, v in parse.model_dump(exclude={"follow_up"}).items() if v not in (None, "unknown")}
        if not any(e.question for e in inquiry.events):
            question = parse.follow_up
    reply = inquiry.reply.model_copy(update=update)
    to = {"yes": "confirmed", "no": "unavailable"}.get(reply.available, "replied")
    _move(
        conn, inquiry, to, now,
        reply=Jsonb(reply.model_dump(mode="json")),
        event_reply=body.model_dump(mode="json", exclude_none=True) | ({"auto": True} if auto else {}),
        event_question=question,
    )
    return _inquiry(conn.execute("SELECT * FROM inquiries WHERE inquiry_id = %s", [inquiry_id]).fetchone())
