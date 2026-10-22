# ADR-0002: Agent orchestration with LangGraph

| | |
|---|---|
| Status | Accepted |
| Date | 2026-10-21 |
| Issue | #13-#17 (spec: #1, PRD section 6.2-6.4) |

## Context

ADR-0001 fixes the model gateway (BoxAPI, OpenAI Chat Completions), the agent stream (AG-UI over SSE) and
the chat surface (CopilotKit), but not what runs the agent loop. The PRD asks for a tool-calling loop,
a Seller Liaison sub-agent, and no inquiry sent before the user consents. Writing the loop ourselves is
small, but then we also write the AG-UI event mapping and the pause/resume for consent.

## Decision

The orchestrator and the Seller Liaison run on LangGraph, with LangChain chat models.

- **Model.** `ChatOpenAI(base_url=LLM_BASE_URL, api_key=LLM_API_KEY, model=LLM_MODEL)` from
  `langchain-openai`; the small model is a second instance with `LLM_SMALL_MODEL`. Env variables are
  unchanged from ADR-0001.
- **Embeddings.** `OpenAIEmbeddings` from the same package, with `check_embedding_ctx_length=False` (raw text).
- **Structured output.** Brief patches (#13) and seller-reply parses (#17) use
  `with_structured_output(<Pydantic model>, method="json_schema")`.
- **Tools.** The PRD tools stay plain typed functions shared with the REST endpoints; the graph wraps them
  as LangChain tools. Block types (`product_cards`, `seller_compare`, ...) are tool results, as in ADR-0001.
- **Stream.** `ag_ui_langgraph.add_langgraph_fastapi_endpoint(app, graph, "/agent")` exposes the graph as
  an AG-UI endpoint. CopilotKit's `HttpAgent` points at it (`AGENT_URL`). No hand-written AG-UI encoder.
- **Consent.** The Seller Liaison is a subgraph. It composes drafts, then calls `interrupt()`; the user's
  tap in the CopilotKit human-in-the-loop action resumes it, and only then are inquiries sent.
  *Amended (#15 wiring):* the interrupt round trip was not proven end to end, so the fallback below is in use:
  `contact_seller` is a plain graph tool that stores drafts and returns the `inquiry_status` block; the block's
  send button calls `POST /sessions/{id}/inquiries/confirm` (`confirm_inquiries`). The model has no send tool.
- **State.** Conversation state and pending interrupts are kept by `langgraph-checkpoint-postgres` in the
  existing database.
- **Outside the graph.** The inquiry store, its state machine (`sent -> no_reply` after N minutes, hours
  check, `closed`), the seller channel port, the Seller Console and the inquiry SSE endpoint are plain
  FastAPI and Postgres. Inquiry events reach the orchestrator on its next turn; it then calls
  `find_alternatives` (#16).
- **Tests.** The scripted fake is a LangChain fake chat model (e.g. `GenericFakeChatModel`) fed scripted
  messages and tool calls. The grounding check reads tool messages from graph state.
- **Degraded mode.** Without `LLM_API_KEY` the graph is not run: free text goes to deterministic search plus
  template text, and free-text seller replies stay `replied` with `available: unknown`. There is no null
  chat model.
  Amended (#13): `/agent` still answers without a key. The orchestrator graph's entry routes to a
  deterministic `degraded` node (search + template text) that calls no model, so the AG-UI stream and the
  bottom sheet stay the same in both modes.
- **Versions.** Pin `langgraph`, `langchain-openai`, `langgraph-checkpoint-postgres` and `ag-ui-langgraph`
  to exact versions in `uv.lock`; upgrade them together on purpose.

## Changes to ADR-0001

1. **Provider adapter.** The LLM provider port is "a LangChain `BaseChatModel` built from env" instead of
   our own Chat Completions adapter. Any OpenAI-compatible gateway still works through `base_url`.
2. **Agent stream.** AG-UI events come from `ag-ui-langgraph` instead of FastAPI `StreamingResponse` with
   the `ag-ui-protocol` encoder. Inquiry updates keep their own plain SSE endpoint.
3. **`gpt-6` models.** Moving to them means `ChatOpenAI(use_responses_api=True)`, not a new adapter of ours.

## Consequences

- Less of our own code for the loop, streaming and interrupts; more dependency surface. LangChain packages
  change often, hence exact pins.
- Before #15 relies on it, a spike confirms that an `interrupt()` in `ag-ui-langgraph` round-trips through
  CopilotKit's human-in-the-loop action and resumes the graph. If it does not, consent falls back to a
  `confirm_inquiries` tool the user's tap calls, with drafts held in the inquiry store.
- If CopilotKit is dropped (ADR-0001 fallback), the graph and its AG-UI endpoint stay as they are.
