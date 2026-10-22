// A stand-in for the FastAPI /agent endpoint: answers every AG-UI run with text, product cards and chips.
import { createServer } from "node:http";

const product = {
  product_id: "p1", title: "هدفون انکر R50i", brand: null, category: null, image_url: null, key_specs: [], offer_count: 2,
  price: { trust_level: "listed", min_toman: 1690000, max_toman: 3500000, per_meter: false, last_price_changed_at: null, price_age_days: 13, price_age_bucket: "8-30" },
  price_flags: [], score_parts: [], meaning_match: false,
};
const directions = {
  shop_id: "shop_a", shop_name: "آذرنوش دیسیس", lat: 35.6949, lon: 51.4115,
  route: { distance_m: 1000, duration_min: 10, source: "neshan" },
  links: {
    neshan: "https://nshn.ir/?origin=35.69,51.42&destination=35.6949,51.4115&vehicle=d",
    balad: "https://balad.ir/location?latitude=35.6949&longitude=51.4115&zoom=18",
    google: "https://www.google.com/maps/dir/?api=1&origin=35.69,51.42&destination=35.6949,51.4115&travelmode=walking",
  },
  last_leg: { pasaj: "علاالدین", landmark: "رو‌به‌روی پاساژ چهارسو", floor: "۲", unit: "۲۱۶" },
};
const plan = {
  origin: { lat: 35.69, lon: 51.42 }, depart_at: "2026-10-22T13:35:00+03:30", mode: "walk",
  stops: [
    { ...directions, eta: "2026-10-22T13:45:00+03:30", open_at_eta: true },
    { ...directions, shop_id: "shop_b", shop_name: "دیسورا پاکیار", eta: "2026-10-22T14:01:00+03:30", open_at_eta: null },
  ],
};
const blocks = [
  { block: "product_cards", query: "هدفون", items: [product] },
  { block: "visit_plan", ...plan },
  { block: "directions", ...directions },
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
        { type: "TOOL_CALL_START", toolCallId: id, toolCallName: { chips: "ask_user", visit_plan: "plan_visit", directions: "get_directions" }[b.block] ?? "search_products" },
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
