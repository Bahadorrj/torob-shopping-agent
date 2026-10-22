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

// Mirrors Brief, Session and SessionPatch in backend/src/pasazhgard/brief.py.
export type Area = { radius_m: number | null; name: string | null; pasaj: string | null };
export type TravelMode = "walk" | "transit" | "car";
export type PaymentKind = "any" | "cash" | "torob_pay" | "installment";

export type MustHave = { warranty: boolean; test_in_presence: boolean; fast_delivery: boolean };

export type Brief = {
  need: string | null;
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

export type Step = { kind: "search" } | { kind: "sellers"; product_id: string; title?: string | null };

export type Session = {
  session_id: string;
  brief: Brief;
  step: Step | null;
  areas: string[];
  pasajs: string[];
  // radius origins without a map: a covered area or pasaj, at the mean position of its shops
  centers: Center[];
  results: SellerList | { query: string; items: ProductCard[] } | null;
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

export async function patchSession(id: string, change: SessionPatch): Promise<Session> {
  const r = await fetch(`/api/sessions/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(change),
  });
  if (!r.ok) throw new Error(`patch failed: ${r.status}`);
  return r.json();
}
