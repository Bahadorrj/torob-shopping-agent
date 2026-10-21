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
