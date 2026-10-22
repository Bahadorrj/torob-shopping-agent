// Reason badge per result: the first match in priority order, skipping a reason every visible row shares.
// No "@/" imports and type-only imports, so `node --test` runs it with plain type stripping.
import type { Brief, ProductCard, SellerRow } from "./api";

const fa = (s: string | number) => String(s).replace(/\d/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[Number(d)]);

type Candidate = { key: string; label: string };

// labels shared by every row drop out, unless only one row is shown; the last candidate is the fallback
function pick(candidates: Candidate[][]): string[] {
  const shared = (key: string) => candidates.length > 1 && candidates.every((c) => c.some((x) => x.key === key));
  return candidates.map((c) => (c.slice(0, -1).find((x) => !shared(x.key)) ?? c[c.length - 1]).label);
}

export function sellerReasons(rows: SellerRow[], brief: Pick<Brief, "priority" | "payment">): string[] {
  const installments = brief.payment.kind === "torob_pay" || brief.payment.kind === "installment";
  return pick(
    rows.map((s) => {
      const has = (kind: string) => s.reasons.find((r) => r.kind === kind);
      const c: (Candidate | null)[] = [
        has("cheapest") ? { key: "cheapest", label: "ارزان‌ترین" } : null,
        has("closest") ? { key: "closest", label: "نزدیک‌ترین" } : null,
      ];
      if (brief.priority === "closest") c.reverse();
      const pay = installments ? has("installments") : undefined;
      const inPerson = pay && s.payment_options.some((p) => p.provider === pay.provider && p.channel === "in_person");
      const warranty = has("warranty");
      c.push(
        has("open_now") ? { key: "open_now", label: "الان باز" } : null,
        pay?.provider ? { key: `pay:${pay.provider}`, label: inPerson ? `${pay.provider} حضوری` : pay.provider } : null,
        warranty ? { key: `warranty:${warranty.months}`, label: warranty.months ? `گارانتی ${fa(warranty.months)} ماهه` : "گارانتی" } : null,
        has("fresh_price") ? { key: "fresh_price", label: "قیمت این هفته" } : null,
        has("declared_hours") ? { key: "declared_hours", label: "ساعت کاری مشخص" } : null,
        s.pasaj ? { key: `pasaj:${s.pasaj}`, label: fa(`پاساژ ${s.pasaj}`) } : null,
        { key: "seller", label: "فروشنده این کالا" },
      );
      return c.filter((x): x is Candidate => x !== null);
    }),
  );
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
