"""The orchestrator (PRD 6.2, ADR-0002): a LangGraph tool loop over the shopping tools, served as AG-UI at /agent.

A turn: patch the session's brief from the user's words (structured output), then call tools until the model
answers. Every block the UI renders is a tool result: a JSON object whose `block` names its renderer.
The LangGraph thread id is the session id, so the brief bar and the agent share one brief.
"""

import json
import os
import uuid
from collections.abc import Callable
from contextlib import AbstractContextManager
from dataclasses import dataclass
from datetime import datetime
from typing import Annotated, Literal

from langchain_core.callbacks import dispatch_custom_event
from langchain_core.language_models import BaseChatModel
from langchain_core.messages import AIMessage, HumanMessage, SystemMessage, ToolMessage
from langchain_core.runnables import RunnableConfig
from langchain_core.tools import InjectedToolCallId, tool
from langchain_openai import ChatOpenAI
from langgraph.graph import END, START, MessagesState, StateGraph
from langgraph.prebuilt import InjectedState, ToolNode
from psycopg.types.json import Jsonb
from pydantic import BaseModel, Field

from pasazhgard.brief import Area, Brief, Budget, Item, Payment, VisitWindow, seller_query
from pasazhgard.compare import compare_products as _compare_products
from pasazhgard.embeddings import Embedder
from pasazhgard.inquiries import Compose
from pasazhgard.inquiries import contact_seller as _contact_seller
from pasazhgard.inquiries import get_inquiries as _get_inquiries
from pasazhgard.search import search_products as _search_products
from pasazhgard.seller_compare import CompareQuery
from pasazhgard.seller_compare import compare_sellers as _compare_sellers
from pasazhgard.sellers import area_options
from pasazhgard.sellers import find_sellers as _find_sellers


def chat_model_from_env(small: bool = False) -> BaseChatModel | None:
    """The chat model port, or with `small` the small model that parses seller replies; None without a key."""
    key = os.environ.get("LLM_API_KEY")
    if not key:
        return None
    return ChatOpenAI(
        base_url=os.environ.get("LLM_BASE_URL", "https://ai.boxapi.ir/ai/v1"),
        api_key=key,
        model=os.environ.get("LLM_SMALL_MODEL", "gpt-5.4-mini") if small else os.environ.get("LLM_MODEL", "gpt-5.6-terra"),
        timeout=60,
        max_retries=1,
    )


@dataclass
class Ports:
    """Read on every run, so tests can swap the model, clock and embedder between turns."""

    model: Callable[[], BaseChatModel | None]
    now: Callable[[], datetime]
    embedder: Callable[[], Embedder | None]
    # a connection that commits on exit
    connect: Callable[[], AbstractContextManager]


class BriefPatch(BaseModel):
    """Brief fields the user's latest message states or changes. Leave every other field null."""

    need: str | None = Field(None, description="what the user wants to buy, in their words, with must-have features")
    area: Area | None = None
    budget: Budget | None = None
    visit_window: VisitWindow | None = None
    payment: Payment | None = None
    quantity: int | None = Field(None, gt=0)


def block(kind: str, payload: BaseModel | dict) -> str:
    """A tool result the UI renders with the `kind` renderer."""
    data = payload.model_dump(mode="json") if isinstance(payload, BaseModel) else payload
    return json.dumps({"block": kind, **data}, ensure_ascii=False)


def error(message: str) -> str:
    """A tool result for the model only; the UI renders nothing for it."""
    return json.dumps({"error": message})


def load_brief(conn, sid: str) -> Brief:
    # a thread may start before its session row exists
    conn.execute(
        "INSERT INTO sessions (session_id, brief) VALUES (%s, %s) ON CONFLICT DO NOTHING",
        [sid, Jsonb(Brief().model_dump(mode="json"))],
    )
    return Brief.model_validate(conn.execute("SELECT brief FROM sessions WHERE session_id = %s", [sid]).fetchone()["brief"])


def apply_patch(brief: Brief, patch: BriefPatch) -> Brief:
    fields = {k: v for k, v in patch.model_dump().items() if v is not None and k != "quantity"}
    if patch.quantity:
        items = brief.items or [Item()]
        fields["items"] = [items[0].model_copy(update={"quantity": patch.quantity}), *items[1:]]
    return Brief.model_validate({**brief.model_dump(), **fields})


def _session(config: RunnableConfig) -> str:
    return config["configurable"]["thread_id"]


BRIEF_PROMPT = """You keep the Shopping Brief of an in-store shopping assistant for Tehran.
Now: {now} (Asia/Tehran). Current brief: {brief}
Return only the fields the user's latest message states or changes; prices are in toman."""

AGENT_PROMPT = """You are Pasazhgard, an in-store shopping assistant for Tehran's shops and pasajs. Reply in short Persian.
Now: {now} (Asia/Tehran). Shopping Brief: {brief}
- Use tools for every product, shop, price and hour. Never state a price, shop or stock that no tool returned;
  the UI shows tool results as cards, so refer to them instead of repeating numbers.
- If a missing brief field would change the answer, call ask_user for that one field and stop.
  Ask one question per turn, and none when the answer would not change the result.
- Never say an item is in stock unless a seller confirmed it.
- contact_seller only drafts messages; the user sends them with the button under the drafts. Never say a message
  was sent or a seller answered unless get_inquiries shows it."""

CHIP_FIELDS = Literal["area", "budget", "visit_window", "payment", "quantity", "need"]


def build_graph(ports: Ports) -> StateGraph:
    """The orchestrator graph, uncompiled: the app compiles it with its checkpointer."""

    def brief_of(config: RunnableConfig) -> Brief:
        with ports.connect() as conn:
            return load_brief(conn, _session(config))

    @tool
    def search_products(query: str) -> str:
        """Search products by Persian or English name, brand, model or need. Shows product cards."""
        with ports.connect() as conn:
            return block("product_cards", _search_products(conn, query, ports.now(), embedder=ports.embedder()))

    @tool
    def compare_products(product_ids: list[str], config: RunnableConfig) -> str:
        """Compare 2-3 products side by side: specs, nearby price range and seller count. Shows a compare table."""
        if not 2 <= len(set(product_ids)) == len(product_ids) <= 3:
            return error("give 2-3 distinct product ids")
        brief, now = brief_of(config), ports.now()
        with ports.connect() as conn:
            result = _compare_products(conn, product_ids, seller_query(brief, product_ids[0], now), now)
        return block("compare_table", result) if result else error("product not found")

    @tool
    def find_sellers(product_id: str, config: RunnableConfig) -> str:
        """Shops selling a product, filtered and ranked by the brief. Shows the seller list."""
        brief, now = brief_of(config), ports.now()
        with ports.connect() as conn:
            result = _find_sellers(conn, product_id, seller_query(brief, product_id, now), now)
        return block("seller_list", result) if result else error("product not found")

    @tool
    def compare_sellers(product_id: str, offer_ids: list[str], config: RunnableConfig) -> str:
        """Compare 1-3 sellers' offers of one product side by side. Shows the seller comparison."""
        brief, now = brief_of(config), ports.now()
        origin = brief.origin
        try:
            q = CompareQuery(
                offer_id=offer_ids,
                lat=origin and origin.lat,
                lon=origin and origin.lon,
                mode=brief.travel_mode or "walk",
                arrival=seller_query(brief, product_id, now).arrival,
            )
        except ValueError:
            return error("give 1-3 distinct offer ids")
        with ports.connect() as conn:
            result = _compare_sellers(conn, product_id, q, now)
        return block("seller_compare", result) if result else error("product or offer not found")

    @tool
    def ask_user(
        field: CHIP_FIELDS,
        question: str,
        state: Annotated[dict, InjectedState],
        call_id: Annotated[str, InjectedToolCallId],
        config: RunnableConfig,
    ) -> str:
        """Ask the user one short Persian question about a missing brief field, answered with chips."""
        asks = [c for c in state["messages"][-1].tool_calls if c["name"] == "ask_user"]
        if asks[0]["id"] != call_id:
            return error("one question per turn")
        brief = brief_of(config)
        answered = {
            "area": brief.area is not None,
            "budget": brief.budget != Budget(),
            "visit_window": brief.visit_window != VisitWindow(),
            "payment": brief.payment != Payment(),
            "quantity": bool(brief.items),
            "need": bool(brief.need),
        }
        if answered[field]:
            return error(f"the brief already has {field}")
        options: list[str] = []
        if field == "area":
            with ports.connect() as conn:
                found = area_options(conn)
            options = ["نزدیک من", *found["areas"], *found["pasajs"]]
        elif field == "payment":
            options = ["نقدی", "اقساطی", "ترب‌پی", "فرقی نمی‌کند"]
        elif field == "visit_window":
            options = ["همین الان", "امروز عصر", "فردا"]
        return block("chips", {"field": field, "question": question, "options": options})

    @tool
    def contact_seller(offer_ids: list[str], config: RunnableConfig) -> str:
        """Draft one short Persian inquiry per offer (1-3 offers): available now, today's price, hold, installments.
        Nothing is sent: the user sends the drafts with a tap. Shows the inquiry tracker."""
        sid = _session(config)
        # creates the session row a thread may start without
        brief_of(config)
        try:
            change = Compose(offer_ids=offer_ids)
            with ports.connect() as conn:
                return block("inquiry_status", _contact_seller(conn, sid, change, ports.now()))
        except LookupError:
            return error("offer not found")
        except ValueError:
            # pydantic's ValidationError is a ValueError too
            return error("give 1-3 distinct offer ids; an item has at most 3 open inquiries")

    @tool
    def get_inquiries(config: RunnableConfig) -> str:
        """This session's inquiries to sellers with each seller's latest reply. Shows the inquiry tracker."""
        sid = _session(config)
        # creates the session row a thread may start without
        brief_of(config)
        with ports.connect() as conn:
            return block("inquiry_status", _get_inquiries(conn, sid))

    tools = [search_products, compare_products, find_sellers, compare_sellers, ask_user, contact_seller, get_inquiries]

    def patch_brief(state: MessagesState, config: RunnableConfig) -> dict:
        sid, brief = _session(config), brief_of(config)
        structured = ports.model().with_structured_output(BriefPatch, method="json_schema")
        prompt = SystemMessage(BRIEF_PROMPT.format(now=ports.now().isoformat(), brief=brief.model_dump_json()))
        # the patch is state, not chat: keep its tokens out of the AG-UI stream
        patch = structured.invoke(
            [prompt, *state["messages"]], config={"metadata": {"emit-messages": False, "emit-tool-calls": False}}
        )
        with ports.connect() as conn:
            conn.execute(
                "UPDATE sessions SET brief = %s, updated_at = now() WHERE session_id = %s",
                [Jsonb(apply_patch(brief, patch).model_dump(mode="json")), sid],
            )
        return {}

    def agent(state: MessagesState, config: RunnableConfig) -> dict:
        brief = brief_of(config)
        prompt = SystemMessage(AGENT_PROMPT.format(now=ports.now().isoformat(), brief=brief.model_dump_json()))
        return {"messages": [ports.model().bind_tools(tools).invoke([prompt, *state["messages"]])]}

    def degraded(state: MessagesState, config: RunnableConfig) -> dict:
        """No model: search the user's words and say so in template text."""
        query = next(m.content for m in reversed(state["messages"]) if isinstance(m, HumanMessage))
        call = {"name": "search_products", "args": {"query": query}, "id": uuid.uuid4().hex, "type": "tool_call"}
        result = search_products.invoke(call, config)
        found = bool(json.loads(result.content)["items"])
        text = (
            f"دستیار هوشمند الان در دسترس نیست؛ این‌ها نتیجهٔ جستجوی «{query}» است."
            if found
            else f"دستیار هوشمند الان در دسترس نیست و برای «{query}» کالایی پیدا نشد. نام یا مدل کالا را دقیق‌تر بنویسید."
        )
        reply = AIMessage(text, id=uuid.uuid4().hex)
        dispatch_custom_event("manually_emit_message", {"message_id": reply.id, "message": text}, config=config)
        return {"messages": [AIMessage("", tool_calls=[call]), result, reply]}

    def after_tools(state: MessagesState) -> str:
        # a question ends the turn: the user's tap or reply is the next turn
        for m in reversed(state["messages"]):
            if not isinstance(m, ToolMessage):
                break
            if json.loads(m.content).get("block") == "chips":
                return END
        return "agent"

    graph = StateGraph(MessagesState)
    graph.add_node(patch_brief)
    graph.add_node(agent)
    graph.add_node("tools", ToolNode(tools))
    graph.add_node(degraded)
    graph.add_conditional_edges(START, lambda _: "degraded" if ports.model() is None else "patch_brief")
    graph.add_edge("patch_brief", "agent")
    graph.add_conditional_edges("agent", lambda s: "tools" if s["messages"][-1].tool_calls else END)
    graph.add_conditional_edges("tools", after_tools)
    graph.add_edge("degraded", END)
    return graph
