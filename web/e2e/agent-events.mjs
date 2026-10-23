// One AG-UI run as server-sent events: each block as a tool result, then the text.
const TOOLS = {
  chips: "ask_user",
  inquiry_status: "contact_seller",
  visit_plan: "plan_visit",
  directions: "get_directions",
  alternatives: "find_alternatives",
  seller_list: "find_sellers",
  shop_details: "shop_details",
  product: "get_product",
};

export function runEvents({ threadId, runId, messages }, blocks, text) {
  const n = messages.length;
  const events = [{ type: "RUN_STARTED", threadId, runId }];
  blocks.forEach((b, i) => {
    const id = `call-${n}-${i}`;
    events.push(
      { type: "TOOL_CALL_START", toolCallId: id, toolCallName: TOOLS[b.block] ?? "search_products" },
      { type: "TOOL_CALL_ARGS", toolCallId: id, delta: "{}" },
      { type: "TOOL_CALL_END", toolCallId: id },
      { type: "TOOL_CALL_RESULT", messageId: `result-${n}-${i}`, toolCallId: id, content: JSON.stringify(b), role: "tool" },
    );
  });
  events.push(
    { type: "TEXT_MESSAGE_START", messageId: `text-${n}`, role: "assistant" },
    { type: "TEXT_MESSAGE_CONTENT", messageId: `text-${n}`, delta: text },
    { type: "TEXT_MESSAGE_END", messageId: `text-${n}` },
    { type: "RUN_FINISHED", threadId, runId },
  );
  return events.map((e) => `data: ${JSON.stringify(e)}

`).join("");
}
