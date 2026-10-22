// A stand-in for the FastAPI /agent endpoint: answers every AG-UI run with text, product cards, inquiry drafts and chips.
import { createServer } from "node:http";

const product = {
  product_id: "p1", title: "هدفون انکر R50i", brand: null, category: null, image_url: null, key_specs: [], offer_count: 2,
  price: { trust_level: "listed", min_toman: 1690000, max_toman: 3500000, per_meter: false, last_price_changed_at: null, price_age_days: 13, price_age_bucket: "8-30" },
  price_flags: [], score_parts: [], meaning_match: false,
};
const reply = { available: "unknown", latest_price_toman: null, hold_until: null, installments: null, notes: null, confidence: null };
const draft = {
  inquiry_id: 7, offer_id: "o1", product_id: "p1", product_title: "هدفون انکر R50i", shop_id: "shop_a", shop_name: "دیسیلا مانسا",
  status: "draft", message: "سلام، وقت بخیر. الان موجود است؟ ممنون.", channel: null,
  simulated: false, reply, events: [{ at: "2026-10-21T12:00:00+03:30", status: "draft", reply: null }],
};
const blocks = [
  { block: "product_cards", query: "هدفون", items: [product] },
  { block: "inquiry_status", inquiries: [draft] },
  { block: "chips", field: "area", question: "کجا می‌خواهید بروید؟", options: ["نزدیک من", "فردوسی", "علاالدین"] },
];

createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    const { threadId, runId, messages } = JSON.parse(body);
    const n = messages.length;
    const events = [{ type: "RUN_STARTED", threadId, runId }];
    blocks.forEach((b, i) => {
      const id = `call-${n}-${i}`;
      events.push(
        { type: "TOOL_CALL_START", toolCallId: id, toolCallName: { chips: "ask_user", inquiry_status: "contact_seller" }[b.block] ?? "search_products" },
        { type: "TOOL_CALL_ARGS", toolCallId: id, delta: "{}" },
        { type: "TOOL_CALL_END", toolCallId: id },
        { type: "TOOL_CALL_RESULT", messageId: `result-${n}-${i}`, toolCallId: id, content: JSON.stringify(b), role: "tool" },
      );
    });
    events.push(
      { type: "TEXT_MESSAGE_START", messageId: `text-${n}`, role: "assistant" },
      { type: "TEXT_MESSAGE_CONTENT", messageId: `text-${n}`, delta: "این هدفون را پیدا کردم." },
      { type: "TEXT_MESSAGE_END", messageId: `text-${n}` },
      { type: "RUN_FINISHED", threadId, runId },
    );
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.end(events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join(""));
  });
}).listen(Number(process.argv[2]));
