"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { useBrief } from "@/components/brief-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { CompareColumn } from "@/lib/api";
import { faDigits, faText, priceAge, toman } from "@/lib/format";

const UNKNOWN = <span className="text-muted-foreground">ثبت نشده</span>;

function Price({ price }: { price: CompareColumn["price"] }) {
  if (price.trust_level !== "listed" || price.min_toman === null || price.max_toman === null) {
    return <span className="text-muted-foreground">قیمت ثبت نشده</span>;
  }
  return (
    <div className="flex flex-col items-start gap-1">
      <span className="font-bold">{toman(price.min_toman, price.max_toman)}</span>
      {price.per_meter && <Badge variant="outline">قیمت هر متر</Badge>}
      <Badge variant="secondary">قیمت ثبت‌شده</Badge>
      <span className="text-xs text-muted-foreground">{priceAge(price.price_age_days)}</span>
      {price.price_age_bucket === ">30" && <span className="text-xs text-amber-700">قیمت قدیمی، استعلام بگیرید</span>}
    </div>
  );
}

function Warranty({ w }: { w: CompareColumn["warranty"] }) {
  if (w.trust_level === "unknown") return UNKNOWN;
  if (w.max_months === null) return <span className="text-muted-foreground">مدت گارانتی ثبت نشده</span>;
  return (
    <span>
      تا {faDigits(w.max_months)} ماه، نزد {faDigits(w.sellers)} فروشنده
    </span>
  );
}

export function ProductCompare({ ids }: { ids: string[] }) {
  const { session, pending, error, patch } = useBrief();
  const [showSame, setShowSame] = useState(false);
  const key = ids.join(",");
  const valid = ids.length >= 2 && ids.length <= 3;

  // entering this step keeps the brief, so a brief bar edit re-runs the compare for its area
  useEffect(() => {
    if (valid) patch({ step: { kind: "compare", product_ids: key.split(",") } });
  }, [key, valid, patch]);

  if (!valid) return <p className="text-sm">دو یا سه کالا برای مقایسه انتخاب کنید.</p>;

  const step = session?.step;
  const results = session?.results;
  const table = step?.kind === "compare" && step.product_ids.join(",") === key && results && "specs" in results ? results : null;
  if (table === null) {
    if (error && !pending) return <p className="text-sm text-destructive">مقایسه انجام نشد. دوباره تلاش کنید.</p>;
    return <p className="text-sm text-muted-foreground">در حال بارگذاری...</p>;
  }

  const { products } = table;
  const same = table.specs.filter((s) => !s.differs);
  const specs = showSame ? table.specs : table.specs.filter((s) => s.differs);
  const cell = "border-b p-2 align-top";
  const label = `${cell} sticky start-0 bg-background text-start text-xs font-medium text-muted-foreground`;

  return (
    <article className="flex flex-col gap-3">
      <h1 className="text-lg font-bold">مقایسه کالاها</h1>
      <p className="text-xs text-muted-foreground" aria-live="polite">
        {pending ? "در حال به‌روزرسانی..." : "قیمت، فروشنده و گارانتی در محدوده‌ای که در نوار بالا انتخاب کرده‌اید."}
      </p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[480px] border-collapse text-sm">
          <thead>
            <tr>
              <td className={label} />
              {products.map((p) => (
                <th key={p.product_id} scope="col" className={`${cell} text-start font-semibold leading-6`}>
                  {p.title}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              <th scope="row" className={label}>
                قیمت در محدوده
              </th>
              {products.map((p) => (
                <td key={p.product_id} className={cell}>
                  <Price price={p.price} />
                </td>
              ))}
            </tr>
            <tr>
              <th scope="row" className={label}>
                فروشنده در محدوده
              </th>
              {products.map((p) => (
                <td key={p.product_id} className={cell}>
                  {p.seller_count > 0 ? (
                    `${faDigits(p.seller_count)} فروشنده ثبت‌شده`
                  ) : (
                    <span className="text-muted-foreground">فروشنده‌ای در این محدوده نیست</span>
                  )}
                </td>
              ))}
            </tr>
            <tr>
              <th scope="row" className={label}>
                گارانتی
              </th>
              {products.map((p) => (
                <td key={p.product_id} className={cell}>
                  <Warranty w={p.warranty} />
                </td>
              ))}
            </tr>
            {specs.map((s) => (
              <tr key={s.key} data-differs={s.differs} className={s.differs ? "bg-amber-50" : undefined}>
                <th scope="row" className={`${label} ${s.differs ? "bg-amber-50" : ""}`}>
                  {faText(s.key)}
                </th>
                {s.values.map((v, i) => (
                  <td key={products[i].product_id} className={`${cell} ${s.differs ? "font-medium" : ""}`}>
                    {v === null ? UNKNOWN : faText(v)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td className={label} />
              {products.map((p) => (
                <td key={p.product_id} className="p-2">
                  <Link href={`/products/${p.product_id}/sellers`} className="font-medium text-primary underline-offset-4 hover:underline">
                    دیدن فروشنده‌ها
                  </Link>
                </td>
              ))}
            </tr>
          </tfoot>
        </table>
      </div>
      {same.length > 0 && (
        <Button variant="outline" size="sm" className="self-start" aria-expanded={showSame} onClick={() => setShowSame(!showSame)}>
          {showSame ? "پنهان کردن ویژگی‌های یکسان" : `نمایش ${faDigits(same.length)} ویژگی یکسان`}
        </Button>
      )}
    </article>
  );
}
