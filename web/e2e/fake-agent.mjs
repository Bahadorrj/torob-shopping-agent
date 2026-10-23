// A stand-in for the FastAPI /agent endpoint: answers every AG-UI run with text, product cards, inquiry drafts, chips
// and a shortlist. SLOW_SELLERS gets one find_sellers call whose result comes a while after the call starts.
import { createServer } from "node:http";

import { runEvents } from "./agent-events.mjs";

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
const pick = (product_id, title, tradeoffs) => ({
  product_id, title, brand: null, category: null, image_url: null,
  key_specs: [{ key: "نسخه بلوتوث", value: "5.3" }], price: product.price, seller_count: 4, tradeoffs,
});
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
  { block: "inquiry_status", inquiries: [draft] },
  { block: "visit_plan", ...plan },
  { block: "directions", ...directions },
  {
    block: "shop_details", shop_id: "shop_d", name: "نیکورا ویوان", address: null, pasaj: "علاالدین", floor: "۲", unit: "۲۱۶",
    landmark: null, payment_options: [], fast_delivery: "unknown", website_url: null, instagram_url: null,
    hours: {
      timezone: "Asia/Tehran", today: "thu",
      week: ["sat", "sun", "mon", "tue", "wed", "thu", "fri"].map((day) => ({ day, status: "declared", shifts: [{ start: "10:00", end: "21:00" }] })),
    },
  },
  { block: "product", product_id: "p4", title: "کابل شارژ انکر", brand: null, category: null, image_urls: [], specs: [] },
  {
    block: "alternatives", inquiry_id: 1, reason: "no_reply",
    alternatives: [{
      kind: "same_product", offer_id: "o9", product_id: "p1", product_title: "هدفون انکر R50i", shop_id: "shop_c", shop_name: "نیکورا ویوان",
      pasaj: "علاالدین", price_toman: 3300000, price_delta_toman: -200000, same_pasaj: true, open_now: true, distance_m: 9,
      tradeoff: "۲۰۰ هزار تومان ارزان‌تر، همین پاساژ، الان باز است",
    }],
  },
  { block: "chips", field: "area", question: "کجا می‌خواهید بروید؟", options: ["نزدیک من", "فردوسی", "علاالدین"] },
  {
    block: "model_shortlist",
    need: "هندزفری ورزشی",
    models: [
      pick("p2", "هندزفری بلوتوثی انکر R50i NC", ["گران‌ترین گزینه", "قابلیت حذف نویز (ANC): دارد"]),
      pick("p3", "هدفون بی سیم کیو سی وای T13x", ["ارزان‌ترین گزینه", "مقاومت در برابر آب (IP): (مقاوم در برابر واترجت اسپری) IPX5"]),
    ],
  },
];

const SLOW_SELLERS = "فروشنده‌ها را پیدا کن";
const sellers = {
  block: "seller_list", product_id: "p1", title: "هدفون انکر R50i", count: 1, ask_them: [], category_only: [],
  nearest_covered: null, areas: [], pasajs: [],
  sellers: [{
    offer_id: "o1", shop_id: "shop_a", shop_name: "دیسیلا مانسا", area: "شیخ هادی", pasaj: null, floor: null, unit: null,
    lat: null, lon: null, distance_m: 40, price_toman: 3500000, per_meter: false, price_age_days: 2, price_age_bucket: "<=7",
    trust_level: "listed", warranty: null, declared_hours: true, open_now: true, payment_options: [], reasons: [],
    latest_price: null, inquiry: null, unknown: [],
  }],
};

createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    const input = JSON.parse(body);
    res.writeHead(200, { "content-type": "text/event-stream" });
    if (input.messages.at(-1)?.content !== SLOW_SELLERS) return res.end(runEvents(input, blocks, "این هدفون را پیدا کردم."));
    const events = runEvents(input, [sellers], "");
    const at = events.indexOf('data: {"type":"TOOL_CALL_RESULT"');
    res.write(events.slice(0, at));
    setTimeout(() => res.end(events.slice(at)), 2000);
  });
}).listen(Number(process.argv[2]));
