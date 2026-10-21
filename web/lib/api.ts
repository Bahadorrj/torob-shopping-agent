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
