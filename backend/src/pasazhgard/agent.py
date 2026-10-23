"""The orchestrator: a LangGraph tool loop over the shopping tools, served as AG-UI at /agent.

A turn: patch the session's brief from the user's words (structured output), then call tools until the model
answers. Every block the UI renders is a tool result: a JSON object whose `block` names its renderer.
The LangGraph thread id is the session id, so the brief bar and the agent share one brief.
"""

import json
import os
import re
import uuid
from collections.abc import Callable
from contextlib import AbstractContextManager
from dataclasses import dataclass
from datetime import datetime
from itertools import takewhile
from textwrap import dedent
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

from pasazhgard.alternatives import find_alternatives as _find_alternatives
from pasazhgard.basket import BasketQuery
from pasazhgard.basket import optimize_basket as _optimize_basket
from pasazhgard.brief import Area, Brief, Budget, Item, Payment, VisitWindow, seller_query
from pasazhgard.compare import compare_products as _compare_products
from pasazhgard.discovery import SuggestQuery
from pasazhgard.discovery import suggest_models as _suggest_models
from pasazhgard.embeddings import Embedder
from pasazhgard.inquiries import Compose
from pasazhgard.inquiries import contact_seller as _contact_seller
from pasazhgard.inquiries import get_inquiries as _get_inquiries
from pasazhgard.routing import Router
from pasazhgard.search import search_products as _search_products
from pasazhgard.seller_compare import CompareQuery
from pasazhgard.seller_compare import compare_sellers as _compare_sellers
from pasazhgard.sellers import area_options
from pasazhgard.sellers import find_sellers as _find_sellers
from pasazhgard.site_prices import FetchQuery, WebFetch
from pasazhgard.site_prices import fetch_site_price as _fetch_site_price
from pasazhgard.visit import DirectionsQuery, PlanQuery
from pasazhgard.visit import get_directions as _get_directions
from pasazhgard.visit import plan_visit as _plan_visit


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
    router: Callable[[], Router]
    # the small model reads website prices off seller pages
    small_model: Callable[[], BaseChatModel | None]
    web: Callable[[], WebFetch]
    # a connection that commits on exit
    connect: Callable[[], AbstractContextManager]


class MustHavePatch(BaseModel):
    """Seller conditions the user turns on (true) or off (false); null leaves one as it is."""

    warranty: bool | None = Field(None, description="the item must come with a warranty, e.g. گارانتی دار, با گارانتی")
    test_in_presence: bool | None = Field(None, description="the user can test the item in the shop")
    fast_delivery: bool | None = None


class BriefPatch(BaseModel):
    """Brief fields the user's latest message states or changes. Leave every other field null."""

    need: str | None = Field(None, description="what the user wants to buy, in their words, with must-have features")
    use: str | None = Field(None, description="what the product is for, e.g. باشگاه, when the user says it")
    features: list[str] | None = Field(None, description="product features the user requires, e.g. ضد آب")
    area: Area | None = None
    budget: Budget | None = None
    visit_window: VisitWindow | None = None
    payment: Payment | None = None
    quantity: int | None = Field(None, gt=0)
    priority: Literal["cheapest", "closest", "most_reliable"] | None = Field(
        None, description="how to rank sellers, e.g. ارزون‌ترین is cheapest, نزدیک‌ترین closest, معتبرترین most_reliable"
    )
    must_have: MustHavePatch | None = None
    travel_mode: Literal["walk", "transit", "car"] | None = Field(None, description="how the user gets there, e.g. با ماشین میرم is car")


def block(kind: str, payload: BaseModel | dict) -> str:
    """A tool result the UI renders with the `kind` renderer."""
    data = payload.model_dump(mode="json") if isinstance(payload, BaseModel) else payload
    return json.dumps({"block": kind, **data}, ensure_ascii=False)


def error(message: str) -> str:
    """A tool result for the model only; the UI renders nothing for it."""
    return json.dumps({"error": message})


def _result(m: ToolMessage) -> dict:
    """A tool result as JSON; {} for the plain-text error the tool node writes for a bad call."""
    try:
        return json.loads(m.content)
    except ValueError:
        return {}


def load_brief(conn, sid: str) -> Brief:
    # a thread may start before its session row exists
    conn.execute(
        "INSERT INTO sessions (session_id, brief) VALUES (%s, %s) ON CONFLICT DO NOTHING",
        [sid, Jsonb(Brief().model_dump(mode="json"))],
    )
    return Brief.model_validate(conn.execute("SELECT brief FROM sessions WHERE session_id = %s", [sid]).fetchone()["brief"])


def apply_patch(brief: Brief, patch: BriefPatch) -> Brief:
    fields = {k: v for k, v in patch.model_dump().items() if v is not None and k != "quantity"}
    if patch.must_have:
        fields["must_have"] = {**brief.must_have.model_dump(), **patch.must_have.model_dump(exclude_none=True)}
    if patch.quantity:
        items = brief.items or [Item()]
        fields["items"] = [items[0].model_copy(update={"quantity": patch.quantity}), *items[1:]]
    # "near me" before any origin: keep the old area; the agent asks for the origin instead
    if patch.area and patch.area.radius_m is not None and brief.origin is None:
        del fields["area"]
    return Brief.model_validate({**brief.model_dump(), **fields})


def _session(config: RunnableConfig) -> str:
    return config["configurable"]["thread_id"]


def build_graph(ports: Ports) -> StateGraph:
    """The orchestrator graph, uncompiled: the app compiles it with its checkpointer."""

    def brief_of(config: RunnableConfig) -> Brief:
        with ports.connect() as conn:
            return load_brief(conn, _session(config))

    def session_of(config: RunnableConfig) -> str:
        """The thread's session id, its row created if the thread started without one."""
        brief_of(config)
        return _session(config)

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
            q = seller_query(brief, product_id, now).model_copy(update={"session_id": _session(config)})
            result = _find_sellers(conn, product_id, q, now)
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
                session_id=_session(config),
            )
        except ValueError:
            return error("give 1-3 distinct offer ids")
        with ports.connect() as conn:
            result = _compare_sellers(conn, product_id, q, now)
        return block("seller_compare", result) if result else error("product or offer not found")

    @tool
    def suggest_models(need: str, config: RunnableConfig) -> str:
        """Shortlist 2-3 models for a need, from models with sellers in the brief's area and budget. Shows the model
        shortlist with trade-offs, nearby price range and seller count. `need`: search words for the product, its use
        and must-have features."""
        brief, now = brief_of(config), ports.now()
        q = SuggestQuery(need=need, **seller_query(brief, "", now).model_dump())
        with ports.connect() as conn:
            result = _suggest_models(conn, q, now, ports.embedder())
        if not result.models:
            return error("no model has a seller in this area and budget; offer to widen the area or the budget")
        return block("model_shortlist", result)

    @tool
    def plan_visit(shop_ids: list[str], config: RunnableConfig) -> str:
        """Order 1-6 shops into a visit from the user's location: ETAs, open at arrival, floor and unit, each shop's
        inquiry; confirmed shops first, an alternative asked in place of a shop that fell through takes its stop. Shows the plan."""
        brief, now = brief_of(config), ports.now()
        if brief.origin is None:
            return error("the brief has no origin: call ask_user for origin")
        try:
            q = PlanQuery(
                shop_id=shop_ids,
                lat=brief.origin.lat,
                lon=brief.origin.lon,
                mode=brief.travel_mode or "walk",
                # the brief's visit time, else now, as the plan link in seller compare does; only .arrival is read
                depart_at=seller_query(brief, "", now).arrival,
                session_id=session_of(config),
            )
        except ValueError:
            return error("give 1-6 distinct shop ids")
        with ports.connect() as conn:
            result = _plan_visit(conn, q, now, ports.router())
        return block("visit_plan", result) if result else error("shop not found")

    @tool
    def get_directions(shop_id: str, config: RunnableConfig) -> str:
        """Route from the user's location to one shop, map app links, then pasaj, floor and unit. Shows directions."""
        brief = brief_of(config)
        if brief.origin is None:
            return error("the brief has no origin: call ask_user for origin")
        q = DirectionsQuery(lat=brief.origin.lat, lon=brief.origin.lon, mode=brief.travel_mode or "walk")
        with ports.connect() as conn:
            result = _get_directions(conn, shop_id, q, ports.router())
        return block("directions", result) if result else error("shop not found")

    @tool
    def find_alternatives(inquiry_id: int, config: RunnableConfig) -> str:
        """The top 2 places to ask instead when a seller inquiry is unavailable, no_reply or closed. Shows them with trade-offs."""
        with ports.connect() as conn:
            try:
                result = _find_alternatives(conn, _session(config), inquiry_id, ports.now())
            except ValueError:
                return error("that inquiry has not fallen through")
        return block("alternatives", result) if result else error("inquiry not found")

    @tool
    def ask_user(
        field: Literal["origin", "area", "budget", "visit_window", "payment", "quantity", "need", "use", "features"],
        question: str,
        state: Annotated[dict, InjectedState],
        call_id: Annotated[str, InjectedToolCallId],
        config: RunnableConfig,
        options: list[str] | None = None,
    ) -> str:
        """Ask the user one short Persian question about a missing brief field, answered with chips.
        `options`: 3-5 short chips for need, use, features and budget; other fields get theirs from the data."""
        asks = [c for c in state["messages"][-1].tool_calls if c["name"] == "ask_user"]
        if asks[0]["id"] != call_id:
            return error("one question per turn")
        brief = brief_of(config)
        answered = {
            "origin": brief.origin is not None,
            "area": brief.area is not None,
            "budget": brief.budget != Budget(),
            "visit_window": brief.visit_window != VisitWindow(),
            "payment": brief.payment != Payment(),
            "quantity": bool(brief.items),
            "need": bool(brief.need),
            "use": bool(brief.use),
            "features": bool(brief.features),
        }
        if answered[field]:
            return error(f"the brief already has {field}")
        results = [_result(m) for m in state["messages"] if isinstance(m, ToolMessage)]
        if field in {r.get("field") for r in results if r.get("block") == "chips"}:
            return error(f"already asked about {field}")
        # questions since the user last saw a result; errors show nothing
        waiting = takewhile(lambda r: r.get("block") in ("chips", None), reversed(results))
        if sum(r.get("block") == "chips" for r in waiting) >= 3:
            return error("at most 3 questions before results: show them now")
        # every question is chips: the model writes them for need, use, features and budget
        options = (options or []) if field in ("need", "use", "features", "budget") else []
        if not options and field in ("need", "use", "features"):
            return error("give 3-5 short options")
        if field == "budget":
            options = options or ["تا ۱ میلیون تومان", "تا ۵ میلیون تومان", "تا ۲۰ میلیون تومان", "فرقی نمی‌کند"]
        elif field == "quantity":
            options = ["۱", "۲", "۳"]
        elif field in ("area", "origin"):
            with ports.connect() as conn:
                found = area_options(conn)
            # the web answers "موقعیت من" with geolocation and an area or pasaj with its center
            options = ["موقعیت من" if field == "origin" else "نزدیک من", *found["areas"], *found["pasajs"]]
        elif field == "payment":
            options = ["نقدی", "اقساطی", "ترب‌پی", "فرقی نمی‌کند"]
        elif field == "visit_window":
            options = ["همین الان", "امروز عصر", "فردا"]
        return block("chips", {"field": field, "question": question, "options": options})

    @tool
    def contact_seller(offer_ids: list[str], config: RunnableConfig, instead_of: int | None = None) -> str:
        """Draft one short Persian inquiry per offer (1-3 offers): available now, today's price, hold, installments.
        Nothing is sent: the user sends the drafts with a tap. Shows the inquiry tracker.
        `instead_of`: when asking one alternative from find_alternatives, the inquiry it replaces in the visit plan."""
        sid = session_of(config)
        try:
            change = Compose(offer_ids=offer_ids, instead_of=instead_of)
            with ports.connect() as conn:
                return block("inquiry_status", _contact_seller(conn, sid, change, ports.now()))
        except LookupError:
            return error("offer or inquiry not found")
        except ValueError:
            # pydantic's ValidationError is a ValueError too
            return error("give 1-3 distinct offer ids, one with instead_of; an item has at most 3 open inquiries")

    @tool
    def optimize_basket(text: str, config: RunnableConfig) -> str:
        """For a shopping list of several items (one per line): the fewest shops in the brief's area that cover it,
        then the lowest total, what each shop covers and what is missing. `text`: the user's list as written. Shows the basket."""
        brief, now = brief_of(config), ports.now()
        q = BasketQuery(text=text, **seller_query(brief, "", now).model_dump())
        with ports.connect() as conn:
            return block("basket", _optimize_basket(conn, q, now))

    @tool
    def get_inquiries(config: RunnableConfig) -> str:
        """This session's inquiries to sellers with each seller's latest reply. Shows the inquiry tracker."""
        sid = session_of(config)
        with ports.connect() as conn:
            return block("inquiry_status", _get_inquiries(conn, sid, ports.now()))

    @tool
    def fetch_site_price(shop_id: str, product_id: str, config: RunnableConfig) -> str:
        """Read a product's latest price from the shop's own website, for shops with a website. Says nothing about stock.
        Shows it in the inquiry tracker; when it is unavailable, offer contact_seller instead."""
        sid = session_of(config)
        with ports.connect() as conn:
            try:
                result = _fetch_site_price(conn, sid, FetchQuery(shop_id=shop_id, product_id=product_id), ports.web(), ports.small_model(), ports.now())
            except ValueError:
                return error("this shop has no website: offer contact_seller instead")
        return block("inquiry_status", {"inquiries": [], "site_prices": [result.model_dump(mode="json")]}) if result else error("shop or product not found")

    tools = [
        search_products, suggest_models, compare_products, find_sellers, compare_sellers, plan_visit, get_directions,
        find_alternatives, ask_user, contact_seller, get_inquiries, fetch_site_price, optimize_basket,
    ]

    def patch_brief(state: MessagesState, config: RunnableConfig) -> dict:
        sid, brief = _session(config), brief_of(config)
        structured = ports.model().with_structured_output(BriefPatch, method="json_schema")
        prompt = dedent(
            """\
            You keep the Shopping Brief of an in-store shopping assistant for Tehran.
            Now: {now} (Asia/Tehran). Current brief: {brief}
            Return only the fields the user's latest message states or changes; prices are in toman."""
        )
        prompt = SystemMessage(prompt.format(now=ports.now().isoformat(), brief=brief.model_dump_json()))
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
        prompt = dedent(
            """\
            You are Pasazhgard, an in-store shopping assistant for Tehran's shops and pasajs. Reply in short Persian.
            Now: {now} (Asia/Tehran). Shopping Brief: {brief}
            - Use tools for every product, shop, price and hour. Never state a price, shop or stock that no tool returned;
              the UI shows tool results as cards, so refer to them instead of repeating numbers.
            - If a missing brief field would change the answer, call ask_user for that one field and stop.
              Ask one question per turn, and none when the answer would not change the result.
              Ask every clarifying question only through ask_user, never in the reply text.
            - Guided discovery: when the user names a need or category rather than a model, or asks for help choosing
              ("کمکم کن انتخاب کنم"), shortlist models with suggest_models before any find_sellers. First ask about use,
              features and budget, at most these three and only what the brief lacks; give use and features 3-5 short options.
              In the reply, explain the trade-offs from the shortlist; do not repeat its prices.
            - Never say an item is in stock unless a seller confirmed it.
            - contact_seller only drafts messages; the user sends them with the button under the drafts. Never say a message
              was sent or a seller answered unless get_inquiries shows it.
            - A website price (fetch_site_price) is the shop's site, not a seller's word: never say it is in stock from it.
            - When an inquiry turns unavailable, no_reply or closed, call find_alternatives for it; to ask an alternative,
              call contact_seller with its offer id and instead_of set to that inquiry.
            - When the user wants shops near them, a visit plan or directions and the brief has no origin,
              call ask_user for origin."""
        )
        prompt = SystemMessage(prompt.format(now=ports.now().isoformat(), brief=brief.model_dump_json()))
        messages = [prompt, *state["messages"]]
        # the text is held back until it is known not to be a question; tool calls still stream
        held = {"metadata": {"emit-messages": False}}
        reply = ports.model().bind_tools(tools).invoke(messages, config=held)
        turn = list(takewhile(lambda m: not isinstance(m, HumanMessage), reversed(state["messages"])))
        asked = any(isinstance(m, ToolMessage) and m.name == "ask_user" for m in turn)
        # only a reply whose last sentence ends in a question mark counts; a "?" in a URL or a name does not
        text = reply.text.strip().rstrip(" \"'»«)]”’!.")
        in_prose = text.endswith(("?", "؟")) and not any(c["name"] == "ask_user" for c in reply.tool_calls)
        # a question in prose is asked again as chips, once per turn so a refused ask cannot loop
        if in_prose and not asked:
            reply = ports.model().bind_tools(tools, tool_choice="ask_user").invoke(messages, config=held)
        elif in_prose:
            # the forced ask was refused: keep the reply before its question, never the chip-less question
            head = re.sub(r"[^.!?؟\n]*[?؟]$", "", text).strip()
            keep = head and not head.endswith(("?", "؟"))
            reply = AIMessage(head if keep else "برای ادامه، بگویید دقیقاً دنبال چه چیزی هستید.", id=reply.id)
        if reply.text:
            dispatch_custom_event("manually_emit_message", {"message_id": reply.id, "message": reply.text}, config=config)
        return {"messages": [reply]}

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
            if _result(m).get("block") == "chips":
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
