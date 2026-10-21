"use client";

import Link from "next/link";
import { useEffect } from "react";

import { useBrief } from "@/components/brief-provider";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { Reason, SellerRow } from "@/lib/api";
import { distance, faDigits, faText, priceAge } from "@/lib/format";

const COVERAGE = "داده‌ها بخشی از فروشگاه‌های تهران، بیشتر مرکز شهر، را پوشش می‌دهند.";

function reasonLabel(r: Reason) {
  switch (r.kind) {
    case "closest":
      return "نزدیک‌ترین";
    case "cheapest":
      return "ارزان‌ترین";
    case "warranty":
      return `گارانتی ${faDigits(r.months ?? 0)} ماهه`;
    case "fresh_price":
      return "قیمت تازه";
    case "declared_hours":
      return "ساعت کاری ثبت‌شده";
  }
}

function place(s: { area: string | null; pasaj: string | null; floor?: string | null; unit?: string | null; distance_m: number | null }) {
  const parts = [
    s.pasaj ? `پاساژ ${s.pasaj}` : s.area,
    s.floor && `طبقه ${s.floor}`,
    s.unit && `واحد ${s.unit}`,
  ].filter(Boolean);
  const text = faText(parts.join("، ") || "مکان ثبت نشده");
  return s.distance_m === null ? text : `${text} · ${distance(s.distance_m)}`;
}

function Seller({ s }: { s: SellerRow }) {
  return (
    <Card className="gap-1.5 p-3">
      <div className="flex items-start justify-between gap-2">
        <Link href={`/shops/${s.shop_id}`} className="font-semibold text-primary underline-offset-4 hover:underline">
          {s.shop_name}
        </Link>
        {s.price_toman !== null ? (
          <span className="shrink-0 text-sm font-bold">{faDigits(s.price_toman)} تومان</span>
        ) : (
          <span className="shrink-0 text-sm text-muted-foreground">قیمت ثبت نشده</span>
        )}
      </div>
      <p className="text-xs text-muted-foreground">{place(s)}</p>
      <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
        {s.trust_level === "listed" ? (
          <>
            <Badge variant="secondary">قیمت ثبت‌شده</Badge>
            {s.per_meter && <Badge variant="outline">قیمت هر متر</Badge>}
            <span>{priceAge(s.price_age_days)}</span>
            {s.price_age_bucket === ">30" && <span className="text-amber-700">قیمت قدیمی، استعلام بگیرید</span>}
          </>
        ) : (
          <Badge variant="outline" className="text-muted-foreground">
            ثبت نشده
          </Badge>
        )}
      </div>
      {s.reasons.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {s.reasons.map((r) => (
            <Badge key={r.kind} variant="outline">
              {reasonLabel(r)}
            </Badge>
          ))}
        </div>
      )}
    </Card>
  );
}

export function SellerList({ productId }: { productId: string }) {
  const { session, pending, error, patch } = useBrief();

  // entering this step keeps the brief; the response carries this product's sellers filtered by it
  useEffect(() => {
    patch({ step: { kind: "sellers", product_id: productId } });
  }, [productId, patch]);

  const step = session?.step;
  const results = session?.results;
  const list = step?.kind === "sellers" && step.product_id === productId && results && "sellers" in results ? results : null;

  if (list === null) {
    if (error && !pending) return <p className="text-sm text-destructive">فهرست فروشنده‌ها دریافت نشد. دوباره تلاش کنید.</p>;
    return <p className="text-sm text-muted-foreground">در حال بارگذاری...</p>;
  }

  const nearest = list.nearest_covered;

  return (
    <article className="flex flex-col gap-4">
      <h1 className="text-lg font-bold leading-7">{list.title}</h1>

      <p className="text-sm" aria-live="polite">
        {pending ? "در حال به‌روزرسانی..." : `${faDigits(list.count)} فروشنده`}
      </p>

      {list.count === 0 ? (
        <div className="flex flex-col gap-2 rounded-lg border p-3 text-sm">
          <p>این محدوده پوشش داده نشده و فروشنده‌ای برای این کالا ندارد.</p>
          <p className="text-muted-foreground">{COVERAGE}</p>
          {nearest && (nearest.area || nearest.pasaj) && (
            <Button
              variant="outline"
              className="h-auto self-start whitespace-normal py-1.5 text-start"
              onClick={() => patch({ brief: { area: nearest.area ? { name: nearest.area } : { pasaj: nearest.pasaj } } })}
            >
              نزدیک‌ترین محدوده با فروشنده: {nearest.area ?? `پاساژ ${faText(nearest.pasaj!)}`}
              {nearest.distance_m !== null && ` (${distance(nearest.distance_m)})`}
            </Button>
          )}
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {list.sellers.map((s) => (
            <li key={s.offer_id}>
              <Seller s={s} />
            </li>
          ))}
        </ul>
      )}

      {list.category_only.length > 0 && (
        <section aria-labelledby="category-only" className="flex flex-col gap-2">
          <h2 id="category-only" className="text-sm font-semibold">
            فروشگاه‌های هم‌دسته
          </h2>
          <p className="text-xs text-muted-foreground">این فروشگاه‌ها این کالا را ثبت نکرده‌اند؛ فقط در همین دسته فعالیت دارند.</p>
          <ul className="flex flex-col gap-2">
            {list.category_only.map((s) => (
              <li key={s.shop_id} className="flex flex-col gap-1 rounded-lg border p-3 text-sm">
                <Link href={`/shops/${s.shop_id}`} className="font-semibold text-primary underline-offset-4 hover:underline">
                  {s.shop_name}
                </Link>
                <span className="text-xs text-muted-foreground">{place(s)}</span>
                <Badge variant="outline" className="text-muted-foreground">
                  فقط دسته فعالیت - موجودی نامشخص
                </Badge>
              </li>
            ))}
          </ul>
        </section>
      )}
    </article>
  );
}
