import type { Message } from "@ag-ui/client";

// Mirrors the backend response models in backend/src/pasazhgard/search.py and PriceFlag in clean.py.
export type PriceFlag = "missing" | "placeholder" | "invalid" | "per_meter" | "far_from_median";

export type PriceRange = {
  trust_level: "listed" | "unknown";
  min_toman: number | null;
  max_toman: number | null;
  per_meter: boolean;
  last_price_changed_at: string | null;
  price_age_days: number | null;
  price_age_bucket: "<=7" | "8-30" | ">30" | null;
};

export type ProductCard = {
  product_id: string;
  title: string;
  brand: string | null;
  category: string | null;
  image_url: string | null;
  key_specs: { key: string; value: string }[];
  offer_count: number;
  price: PriceRange;
  price_flags: PriceFlag[];
  // query words of the match score, and whether the product's title, brand, model or brand alias has each
  score_parts: { word: string; matched: boolean }[];
  // found by meaning (semantic search), whether or not a query word matched
  meaning_match: boolean;
};

export async function searchProducts(q: string): Promise<ProductCard[]> {
  const r = await fetch(`/api/products/search?${new URLSearchParams({ q })}`);
  if (!r.ok) throw new Error(`search failed: ${r.status}`);
  return (await r.json()).items;
}

// Mirrors ShopDetails in backend/src/pasazhgard/shops.py.
export type Day = "sat" | "sun" | "mon" | "tue" | "wed" | "thu" | "fri";

export type DayHours = {
  day: Day;
  status: "declared" | "closed" | "unsupported" | "unknown";
  shifts: { start: string; end: string }[];
};

export type ShopDetails = {
  shop_id: string;
  name: string;
  address: string | null;
  pasaj: string | null;
  floor: string | null;
  unit: string | null;
  landmark: string | null;
  hours: { timezone: "Asia/Tehran"; today: Day; week: DayHours[] };
  payment_options: { provider: string; channel: "in_person" | "unknown" }[];
  fast_delivery: "yes" | "no" | "unknown";
  website_url: string | null;
  instagram_url: string | null;
};

export async function getShop(shopId: string): Promise<ShopDetails | null> {
  const r = await fetch(`/api/shops/${encodeURIComponent(shopId)}`);
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`shop failed: ${r.status}`);
  return r.json();
}

// Mirrors SellerList in backend/src/pasazhgard/sellers.py.
export type PasajShop = {
  shop_id: string;
  shop_name: string;
  unit: string | null;
  products: { product_id: string; title: string; price_toman: number | null }[];
};

// `floor` null groups the shops whose floor is not recorded
export type PasajView = { pasaj: string; count: number; floors: { floor: string | null; level: number | null; shops: PasajShop[] }[] };

export async function getPasaj(pasaj: string, productIds: string[], sessionId?: string): Promise<PasajView | null> {
  const q = new URLSearchParams([...productIds.map((id) => ["product_id", id]), ...(sessionId ? [["session_id", sessionId]] : [])]);
  const r = await fetch(`/api/pasajs/${encodeURIComponent(pasaj)}?${q}`);
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`pasaj failed: ${r.status}`);
  return r.json();
}

export type Priority = "cheapest" | "closest" | "most_reliable";

export type Reason = {
  kind: "closest" | "cheapest" | "open_now" | "warranty" | "fresh_price" | "declared_hours" | "installments";
  months: number | null;
  provider: string | null;
};

export type Condition = "hours" | "payment" | "warranty" | "test_in_presence" | "fast_delivery";

export type SellerRow = {
  offer_id: string;
  shop_id: string;
  shop_name: string;
  area: string | null;
  pasaj: string | null;
  floor: string | null;
  unit: string | null;
  lat: number | null;
  lon: number | null;
  distance_m: number | null;
  price_toman: number | null;
  per_meter: boolean;
  price_age_days: number | null;
  price_age_bucket: PriceRange["price_age_bucket"];
  trust_level: "listed" | "unknown";
  warranty: { kind: "warranty" | "test_in_presence" | "none"; provider: string | null; months: number | null; description: string | null } | null;
  declared_hours: boolean;
  open_now: boolean | null;
  payment_options: { provider: string; channel: "in_person" | "unknown" }[];
  reasons: Reason[];
  latest_price: LatestPrice;
  // the session's latest sent inquiry to this shop about this product
  inquiry: Outcome | null;
  // active conditions with no recorded value; set only in ask_them
  unknown: Condition[];
};

export type CategoryShop = {
  shop_id: string;
  shop_name: string;
  area: string | null;
  pasaj: string | null;
  distance_m: number | null;
  trust_level: "category_only";
};

export type SellerList = {
  product_id: string;
  title: string;
  count: number;
  sellers: SellerRow[];
  ask_them: SellerRow[];
  category_only: CategoryShop[];
  nearest_covered: { area: string | null; pasaj: string | null; distance_m: number | null } | null;
  areas: string[];
  pasajs: string[];
};

// Mirrors ProductCompare in backend/src/pasazhgard/compare.py. Nearby means in the brief's area.
export type CompareColumn = {
  product_id: string;
  title: string;
  brand: string | null;
  image_url: string | null;
  price: PriceRange;
  seller_count: number;
  // `sellers` with a warranty term, and the longest term
  warranty: { trust_level: "listed" | "unknown"; sellers: number; max_months: number | null };
};

export type ProductCompare = {
  products: CompareColumn[];
  // one value per product, null where a product does not record the spec
  specs: { key: string; values: (string | null)[]; differs: boolean }[];
};

// Mirrors Shortlist in backend/src/pasazhgard/discovery.py. Nearby means in the brief's area and budget.
export type ModelPick = {
  product_id: string;
  title: string;
  brand: string | null;
  category: string | null;
  image_url: string | null;
  key_specs: { key: string; value: string }[];
  price: PriceRange;
  seller_count: number;
  // plain lines from the data: price and seller standing among the picks, spec values that differ
  tradeoffs: string[];
};

export type Shortlist = { need: string; models: ModelPick[] };

// Mirrors Brief, Session and SessionPatch in backend/src/pasazhgard/brief.py.
export type Area = { radius_m: number | null; name: string | null; pasaj: string | null };
export type TravelMode = "walk" | "transit" | "car";
export type PaymentKind = "any" | "cash" | "torob_pay" | "installment";

export type MustHave = { warranty: boolean; test_in_presence: boolean; fast_delivery: boolean };

export type Brief = {
  need: string | null;
  use: string | null;
  features: string[];
  items: { product_id: string | null; category: string | null; quantity: number; unit: "piece" | "meter" }[];
  budget: { max_total_toman: number | null; max_per_item_toman: number | null };
  origin: { lat: number; lon: number } | null;
  area: Area | null;
  visit_window: { date: string | null; earliest_arrival: string | null; latest_departure: string | null };
  travel_mode: TravelMode | null;
  payment: { kind: PaymentKind; provider: string | null };
  must_have: MustHave;
  priority: Priority;
  plan: unknown[];
  inquiries: unknown[];
};

export type Center = { kind: "area" | "pasaj"; name: string; lat: number; lon: number };

export type Step =
  | { kind: "search" }
  | { kind: "sellers"; product_id: string; title?: string | null }
  | { kind: "compare"; product_ids: string[] };

export type Session = {
  session_id: string;
  brief: Brief;
  step: Step | null;
  areas: string[];
  pasajs: string[];
  // radius origins without a map: a covered area or pasaj, at the mean position of its shops
  centers: Center[];
  results: SellerList | { query: string; items: ProductCard[] } | ProductCompare | null;
};

// `brief` replaces the top-level fields it names
export type SessionPatch = { brief?: { [K in keyof Brief]?: unknown }; step?: Step | null };

export async function createSession(): Promise<Session> {
  const r = await fetch("/api/sessions", { method: "POST" });
  if (!r.ok) throw new Error(`session failed: ${r.status}`);
  return r.json();
}

export async function getSession(id: string): Promise<Session | null> {
  const r = await fetch(`/api/sessions/${encodeURIComponent(id)}`);
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`session failed: ${r.status}`);
  return r.json();
}

// the session's agent thread as AG-UI messages, for the sheet after a reload
export async function getThread(id: string): Promise<Message[]> {
  const r = await fetch(`/api/sessions/${encodeURIComponent(id)}/messages`);
  if (!r.ok) throw new Error(`thread failed: ${r.status}`);
  return r.json();
}

export async function patchSession(id: string, change: SessionPatch): Promise<Session> {
  const r = await fetch(`/api/sessions/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(change),
  });
  if (!r.ok) throw new Error(`patch failed: ${r.status}`);
  return r.json();
}

// Mirrors SellerCompare in backend/src/pasazhgard/seller_compare.py.
export type SellerColumn = SellerRow & {
  travel_min: number | null;
  arrival_at: string;
  open_at_arrival: boolean | null;
  fast_delivery: "yes" | "no" | "unknown";
};

export type SellerCompare = {
  product_id: string;
  title: string;
  travel_mode: TravelMode;
  travel_estimate: "straight_line";
  sellers: SellerColumn[];
};

export type CompareParams = { lat?: number; lon?: number; mode?: TravelMode; arrival?: string; session_id?: string };

export async function compareSellers(productId: string, offerIds: string[], p: CompareParams): Promise<SellerCompare | null> {
  const q = new URLSearchParams(offerIds.map((id) => ["offer_id", id]));
  for (const [k, v] of Object.entries(p)) if (v !== undefined) q.set(k, String(v));
  const r = await fetch(`/api/products/${encodeURIComponent(productId)}/sellers/compare?${q}`);
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`compare failed: ${r.status}`);
  return r.json();
}

// Mirrors backend/src/pasazhgard/inquiries.py.
// closed: the shop was closed at consent; queued: goes out when it opens; no_reply: no answer in N minutes
export type InquiryState = "draft" | "closed" | "queued" | "sent" | "replied" | "confirmed" | "unavailable" | "no_reply";

export type Reply = {
  available: "yes" | "no" | "unknown";
  latest_price_toman: number | null;
  hold_until: string | null;
  installments: boolean | null;
  notes: string | null;
  confidence: number | null;
};

// what the seller sends from the Seller Console: one quick reply field, or free text
export type ConsoleReply = {
  available?: "yes" | "no";
  latest_price_toman?: number;
  hold_until?: string;
  installments?: boolean;
  text?: string;
};

export type Inquiry = {
  inquiry_id: number;
  // null when the shop does not list the item and is asked anyway
  offer_id: string | null;
  product_id: string;
  product_title: string;
  shop_id: string;
  shop_name: string;
  status: InquiryState;
  message: string;
  channel: string | null;
  simulated: boolean;
  reply: Reply;
  // question: the Seller Liaison's one follow-up to the seller after an ambiguous free-text reply
  events: { at: string; status: InquiryState; reply: ConsoleReply | null; question: string | null }[];
  // an alternative asked in place of this inquiry of the session
  instead_of: number | null;
};

// a price read from the shop's website: says nothing about stock; unavailable when the site failed or showed no price
export type SitePrice = {
  shop_id: string;
  shop_name: string;
  product_id: string;
  status: "found" | "unavailable";
  price_toman: number | null;
  trust_level: "website_price";
  fetched_at: string;
  url: string;
};

export type InquiryStatus = { inquiries: Inquiry[]; site_prices?: SitePrice[] };

export type ConsoleInbox = { shop_id: string; shop_name: string; inquiries: Inquiry[] };

export type LatestPrice = {
  status: "not_asked" | "asked" | "website" | "confirmed";
  price_toman: number | null;
  trust_level: "confirmed" | "website_price" | "unknown";
  at: string | null;
};

export type Outcome = {
  inquiry_id: number;
  status: InquiryState;
  // "yes" only from a seller, so always with replied_at
  available: Reply["available"];
  latest_price_toman: number | null;
  hold_until: string | null;
  installments: boolean | null;
  replied_at: string | null;
};

async function post<T>(url: string, body: unknown): Promise<T> {
  const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`${url} failed: ${r.status}`);
  return r.json();
}

const inquiriesUrl = (sessionId: string) => `/api/sessions/${encodeURIComponent(sessionId)}/inquiries`;

export const inquiriesStreamUrl = (sessionId: string) => `${inquiriesUrl(sessionId)}/stream`;

export const consoleStreamUrl = (shopId: string, token: string) =>
  `/api/console/shops/${encodeURIComponent(shopId)}/inquiries/stream?token=${encodeURIComponent(token)}`;

export type Ask = { product_id: string; shop_id: string };

// drafts only: nothing reaches a seller before confirmInquiries
// `insteadOf`: the inquiry that fell through, when asking an alternative; it takes that stop in the visit plan
export const composeInquiries = (sessionId: string, offerIds: string[], asks: Ask[] = [], insteadOf?: number) =>
  post<InquiryStatus>(inquiriesUrl(sessionId), { offer_ids: offerIds, asks, instead_of: insteadOf });

// `queue`: a shop closed now gets the message when it opens
export const confirmInquiries = (sessionId: string, inquiryIds: number[], queue = false) =>
  post<InquiryStatus>(`${inquiriesUrl(sessionId)}/confirm`, { inquiry_ids: inquiryIds, queue });

// Mirrors Alternatives in backend/src/pasazhgard/alternatives.py.
export type Alternative = {
  kind: "same_product" | "similar_product" | "category_only" | "fast_delivery";
  offer_id: string | null;
  product_id: string;
  product_title: string;
  shop_id: string;
  shop_name: string;
  pasaj: string | null;
  price_toman: number | null;
  price_delta_toman: number | null;
  same_pasaj: boolean;
  open_now: boolean | null;
  distance_m: number | null;
  tradeoff: string;
};

export type Alternatives = { inquiry_id: number; reason: "unavailable" | "no_reply" | "closed"; alternatives: Alternative[] };

export async function getAlternatives(sessionId: string, inquiryId: number): Promise<Alternatives> {
  const r = await fetch(`${inquiriesUrl(sessionId)}/${inquiryId}/alternatives`);
  if (!r.ok) throw new Error(`alternatives failed: ${r.status}`);
  return r.json();
}

// the one tap on an alternative: the tap is the consent, so the draft is sent straight away
export async function askAlternative(sessionId: string, a: Alternative, insteadOf: number) {
  const { inquiries } = await composeInquiries(
    sessionId,
    a.offer_id ? [a.offer_id] : [],
    a.offer_id ? [] : [{ product_id: a.product_id, shop_id: a.shop_id }],
    insteadOf,
  );
  return confirmInquiries(sessionId, inquiries.map((i) => i.inquiry_id));
}

export const sendReply = (inquiryId: number, reply: ConsoleReply, token: string) =>
  post<Inquiry>(`/api/console/inquiries/${inquiryId}/replies?token=${encodeURIComponent(token)}`, reply);

// Mirrors Directions and VisitPlan in backend/src/pasazhgard/visit.py and Route in routing.py.
export type Route = { distance_m: number; duration_min: number; source: "neshan" | "straight_line" };

export type Directions = {
  shop_id: string;
  shop_name: string;
  lat: number;
  lon: number;
  route: Route;
  links: { neshan: string; balad: string; google: string };
  last_leg: { pasaj: string | null; landmark: string | null; floor: string | null; unit: string | null };
};

export async function getDirections(shopId: string, from: { lat: number; lon: number }, mode: TravelMode): Promise<Directions | null> {
  const q = new URLSearchParams({ lat: String(from.lat), lon: String(from.lon), mode });
  const r = await fetch(`/api/shops/${encodeURIComponent(shopId)}/directions?${q}`);
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`directions failed: ${r.status}`);
  return r.json();
}

// the shop's latest sent inquiry in the plan's session
export type StopInquiry = Outcome & {
  product_id: string;
  product_title: string;
  listed_price_toman: number | null;
  // the seller's price minus the listed one
  price_delta_toman: number | null;
  // the seller's price, else the listed one, against the brief's budget
  over_budget: boolean;
};

// `route` is the leg from the previous stop, or from the origin for the first one
export type Stop = Directions & { eta: string; open_at_eta: boolean | null; inquiry: StopInquiry | null };

export type Swap = { shop_id: string; shop_name: string; offer_id: string; price_toman: number | null; distance_m: number | null };

// a stop that closes between leaving and arriving; `swap` is another seller of its item, open then
export type ClosingNudge = { kind: "closing"; shop_id: string; shop_name: string; closes_at: string; leave_by: string; swap: Swap | null };

// a seller-confirmed or website price other than the listed one, against the brief's budget
export type PriceNudge = {
  kind: "price";
  shop_id: string;
  shop_name: string;
  product_id: string;
  product_title: string;
  listed_price_toman: number;
  latest_price_toman: number;
  price_delta_toman: number;
  trust_level: "confirmed" | "website_price";
  over_budget: boolean;
};

export type VisitPlan = {
  origin: { lat: number; lon: number };
  depart_at: string;
  mode: TravelMode;
  stops: Stop[];
  nudges: (ClosingNudge | PriceNudge)[];
};

// a plan with a session_id follows the session's inquiries
export const visitPlanStreamUrl = (query: string) => `/api/visit-plan/stream?${query}`;

// `query` is the plan page's own query string, so a shared link asks for the same plan
export async function getVisitPlan(query: string): Promise<VisitPlan | null> {
  const r = await fetch(`/api/visit-plan?${query}`);
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`plan failed: ${r.status}`);
  return r.json();
}

// Mirrors Basket in backend/src/pasazhgard/basket.py.
export type BasketItem = { line: string; product_id: string | null; title: string | null; category: string | null; quantity: number; unit: "piece" | "meter" };
export type BasketStopItem = {
  item: number;
  offer_id: string | null;
  price_toman: number | null;
  per_meter: boolean;
  total_toman: number | null;
  trust_level: "listed" | "unknown" | "category_only";
};
export type BasketStop = {
  shop_id: string;
  shop_name: string;
  address: string | null;
  pasaj: string | null;
  floor: string | null;
  unit: string | null;
  items: BasketStopItem[];
  total_toman: number;
};
export type Basket = { items: BasketItem[]; stops: BasketStop[]; missing: number[]; total_toman: number };

export async function optimizeBasket(text: string, b: Brief): Promise<Basket> {
  const area = { lat: b.origin?.lat, lon: b.origin?.lon, radius_m: b.area?.radius_m, area: b.area?.name, pasaj: b.area?.pasaj };
  const r = await fetch("/api/basket", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text, ...area }) });
  if (!r.ok) throw new Error(`basket failed: ${r.status}`);
  return r.json();
}
