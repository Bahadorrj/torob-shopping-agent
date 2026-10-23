// Reason badge per result: the first match in priority order, skipping a reason every visible row shares.
// No "@/" imports and type-only imports, so `node --test` runs it with plain type stripping.
import type { ProductCard, SellerRow } from "./api";

const fa = (s: string | number) => String(s).replace(/\d/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[Number(d)]);

type Candidate = { key: string; label: string };

// labels shared by every row drop out, unless only one row is shown; the last candidate is the fallback
function pick(candidates: Candidate[][]): string[] {
  const shared = (key: string) => candidates.length > 1 && candidates.every((c) => c.some((x) => x.key === key));
  return candidates.map((c) => (c.slice(0, -1).find((x) => !shared(x.key)) ?? c[c.length - 1]).label);
}

// every reason of one seller row, as short chips in a fixed order
export function sellerChips(s: SellerRow): string[] {
  const label = (r: SellerRow["reasons"][number]) =>
    ({
      cheapest: "ارزان‌ترین",
      closest: "نزدیک‌ترین",
      open_now: "الان باز",
      installments: r.provider ? `${r.provider}${s.payment_options.some((p) => p.provider === r.provider && p.channel === "in_person") ? " حضوری" : ""}` : "اقساط",
      warranty: r.months ? `گارانتی ${fa(r.months)} ماهه` : "گارانتی",
      fresh_price: "قیمت این هفته",
      declared_hours: "ساعت کاری مشخص",
    })[r.kind];
  const order = ["cheapest", "closest", "open_now", "installments", "warranty", "fresh_price", "declared_hours"];
  const chips = order.flatMap((k) => s.reasons.filter((r) => r.kind === k).map(label));
  return chips.length > 0 ? chips : [s.pasaj ? fa(`پاساژ ${s.pasaj}`) : "فروشنده این کالا"];
}

// score parts as chips plus one sentence built from the same values
export function productWhy(p: ProductCard): { chips: string[]; sentence: string } {
  const found = p.score_parts.filter((w) => w.matched).map((w) => w.word);
  const missed = p.score_parts.filter((w) => !w.matched).map((w) => w.word);
  const chips = [...found.map((w) => `«${w}» در عنوان یا برند`), ...missed.map((w) => `«${w}» پیدا نشد`), ...(p.meaning_match ? ["هم‌معنا با جستجو"] : [])];
  const list = (ws: string[]) => ws.map((w) => `«${w}»`).join(" و ");
  const parts = [
    found.length > 0 && `${list(found)} در عنوان یا برند این کالا هست`,
    missed.length > 0 && `${list(missed)} در آن پیدا نشد`,
    p.meaning_match && "از نظر معنی به جستجوی شما نزدیک است",
    `${fa(p.offer_count)} فروشگاه آن را دارند`,
  ];
  return { chips, sentence: `${parts.filter(Boolean).join("؛ ")}.` };
}

export function productReasons(cards: ProductCard[]): string[] {
  const prices = cards.flatMap((p) => (p.price.min_toman === null ? [] : [p.price.min_toman]));
  const most = Math.max(...cards.map((p) => p.offer_count));
  return pick(
    cards.map((p) =>
      [
        prices.length >= 2 && p.price.min_toman === Math.min(...prices) ? { key: "cheapest", label: "ارزان‌ترین" } : null,
        cards.length >= 2 && most >= 3 && p.offer_count === most ? { key: "most_sellers", label: "بیشترین فروشنده" } : null,
        p.price.price_age_bucket === "<=7" ? { key: "fresh_price", label: "قیمت این هفته" } : null,
        p.score_parts.length > 0 && p.score_parts.every((w) => w.matched) ? { key: "matched", label: "مطابق جستجو" } : null,
        p.meaning_match ? { key: "meaning", label: "هم‌معنا با جستجو" } : null,
        { key: "count", label: `در ${fa(p.offer_count)} فروشگاه` },
      ].filter((x): x is Candidate => x !== null),
    ),
  );
}
