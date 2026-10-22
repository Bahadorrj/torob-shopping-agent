"""Seller Liaison outside the graph (ADR-0002): the inquiry store, its state machine and the seller channel port."""

import datetime as dt
from typing import Annotated, Literal, Protocol, Self

from psycopg.types.json import Jsonb
from pydantic import AfterValidator, BaseModel, Field, model_validator

from pasazhgard.sellers import distinct

Status = Literal["draft", "sent", "replied", "confirmed", "unavailable"]
Question = Literal["available", "price", "hold", "installments"]


class Reply(BaseModel):
    """A seller reply in the parsed shape (PRD 6.4); the inquiry keeps the merge of every reply."""

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


class Inquiry(BaseModel):
    inquiry_id: int
    offer_id: str
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


class InquiryStatus(BaseModel):
    """The `inquiry_status` block: a session's inquiries, oldest first."""

    inquiries: list[Inquiry]


class Compose(BaseModel):
    offer_ids: Annotated[list[str], Field(min_length=1, max_length=3), AfterValidator(distinct)]
    questions: Annotated[list[Question], AfterValidator(distinct)] = ["available", "price", "hold", "installments"]


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


def get_inquiries(conn, sid: str) -> InquiryStatus | None:
    """None when the session does not exist."""
    if conn.execute("SELECT 1 FROM sessions WHERE session_id = %s", [sid]).fetchone() is None:
        return None
    rows = conn.execute("SELECT * FROM inquiries WHERE session_id = %s ORDER BY inquiry_id", [sid]).fetchall()
    return InquiryStatus(inquiries=[_inquiry(r) for r in rows])


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
    by_id = {o["offer_id"]: o for o in offers}
    products = [o["product_id"] for o in offers]
    # a new compose replaces the item's unsent drafts
    conn.execute("DELETE FROM inquiries WHERE session_id = %s AND status = 'draft' AND product_id = ANY(%s)", [sid, products])
    for p in set(products):
        open_ = conn.execute(
            "SELECT count(*) AS n FROM inquiries WHERE session_id = %s AND product_id = %s AND status IN ('sent', 'replied')", [sid, p]
        ).fetchone()["n"]
        if open_ + products.count(p) > 3:
            raise ValueError(f"{p} has {open_} open inquiries")
    drafts = []
    for oid in change.offer_ids:
        o = by_id[oid]
        message = _message(o["product_title"], change.questions, hold and dt.time.fromisoformat(hold))
        drafts.append(
            conn.execute(
                """
                INSERT INTO inquiries (session_id, offer_id, product_id, product_title, shop_id, shop_name, status, message, reply, events)
                VALUES (%s, %s, %s, %s, %s, %s, 'draft', %s, %s, %s) RETURNING *
                """,
                [sid, oid, o["product_id"], o["product_title"], o["shop_id"], o["shop_name"], message, Jsonb(Reply().model_dump()),
                 Jsonb([Event(at=now, status="draft").model_dump(mode="json")])],
            ).fetchone()
        )
    return InquiryStatus(inquiries=[_inquiry(r) for r in drafts])


class Confirm(BaseModel):
    inquiry_ids: Annotated[list[int], Field(min_length=1, max_length=3), AfterValidator(distinct)]


def _move(conn, inquiry: Inquiry, to: Status, now: dt.datetime, **changes) -> None:
    """The one place a status changes; the timeline gets the step. Raises ValueError for a move the machine does not allow."""
    replied = {"replied", "confirmed", "unavailable"}
    # a seller may correct an earlier reply, so the replied states lead to each other
    allowed = {"draft": {"sent"}, "sent": replied, **dict.fromkeys(replied, replied)}
    if to not in allowed[inquiry.status]:
        raise ValueError(f"{inquiry.status} -> {to}")
    events = [*inquiry.events, Event(at=now, status=to, reply=changes.pop("event_reply", None))]
    sets = ", ".join(f"{k} = %s" for k in changes)
    conn.execute(
        f"UPDATE inquiries SET status = %s, events = %s{', ' + sets if sets else ''} WHERE inquiry_id = %s",
        [to, Jsonb([e.model_dump(mode="json") for e in events]), *changes.values(), inquiry.inquiry_id],
    )


def confirm_inquiries(conn, sid: str, change: Confirm, channel: "SellerChannel", now: dt.datetime) -> InquiryStatus | None:
    """The user's consent: send these drafts through the channel. Already sent ones stay as they are.

    None when the session does not exist; LookupError for an inquiry of another session.
    """
    status = get_inquiries(conn, sid)
    if status is None:
        return None
    mine = {i.inquiry_id: i for i in status.inquiries}
    if missing := set(change.inquiry_ids) - set(mine):
        raise LookupError(missing)
    for iid in change.inquiry_ids:
        if mine[iid].status == "draft":
            channel.send(conn, mine[iid])
            _move(conn, mine[iid], "sent", now, channel=channel.name)
    return get_inquiries(conn, sid)


class SellerChannel(Protocol):
    """Port to the seller. Replies come back through `record_reply`, whatever the channel."""

    name: str

    def send(self, conn, inquiry: Inquiry) -> None: ...


class SellerConsole:
    """Demo channel: the shop's Seller Console page reads its sent inquiries from the store, so sending is addressing."""

    name = "seller_console"

    def send(self, conn, inquiry: Inquiry) -> None:
        pass


class ConsoleInbox(BaseModel):
    shop_id: str
    shop_name: str
    inquiries: list[Inquiry]


def console_inbox(conn, shop_id: str) -> ConsoleInbox | None:
    """A shop's inquiries sent through the Seller Console, newest first. None for an unknown shop."""
    shop = conn.execute("SELECT name FROM shops WHERE shop_id = %s", [shop_id]).fetchone()
    if shop is None:
        return None
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


def record_reply(conn, inquiry_id: int, body: ConsoleReply, now: dt.datetime) -> Inquiry:
    """Merge a seller reply into the inquiry. LookupError for an unknown inquiry, ValueError for one not sent yet."""
    row = conn.execute("SELECT * FROM inquiries WHERE inquiry_id = %s FOR UPDATE", [inquiry_id]).fetchone()
    if row is None:
        raise LookupError(inquiry_id)
    inquiry = _inquiry(row)
    sent = body.model_dump(exclude_none=True)
    # shortcut: free text is stored as-is and leaves the parse alone, until the free-text parser exists
    quick = {k: v for k, v in sent.items() if k != "text"}
    reply = inquiry.reply.model_copy(update=quick | ({"confidence": 1.0} if quick else {}))
    to = {"yes": "confirmed", "no": "unavailable"}.get(reply.available, "replied")
    _move(conn, inquiry, to, now, reply=Jsonb(reply.model_dump(mode="json")), event_reply=body.model_dump(mode="json", exclude_none=True))
    return _inquiry(conn.execute("SELECT * FROM inquiries WHERE inquiry_id = %s", [inquiry_id]).fetchone())
