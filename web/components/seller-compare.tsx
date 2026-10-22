"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { MODES } from "@/components/brief-bar";
import { useBrief } from "@/components/brief-provider";
import { DELIVERY, NotRecorded } from "@/components/shop-details";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { compareSellers, type Brief, type CompareParams, type SellerColumn, type SellerCompare as Compare } from "@/lib/api";
import { distance, faDigits, faText, localDate, priceAge } from "@/lib/format";

function params(b: Brief): CompareParams {
  const v = b.visit_window;
  return {
    lat: b.origin?.lat,
    lon: b.origin?.lon,
    mode: b.travel_mode ?? undefined,
    // Tehran has had no daylight saving time since 2022, so its offset is fixed
    arrival: v.earliest_arrival ? `${v.date ?? localDate()}T${v.earliest_arrival.slice(0, 5)}:00+03:30` : undefined,
  };
}

function warranty(w: SellerColumn["warranty"]) {
  if (w === null) return null;
  if (w.kind === "none") return "ندارد";
  if (w.kind === "test_in_presence") return "تست در حضور مشتری";
  if (w.months) return `${faDigits(w.months)} ماه${w.provider ? ` ${w.provider}` : ""}`;
  return w.description && faText(w.description);
}

const ROWS: [string, (s: SellerColumn) => React.ReactNode][] = [
  [
    "قیمت ثبت‌شده",
    (s) =>
      s.price_toman === null ? (
        <NotRecorded text="قیمت ثبت نشده" />
      ) : (
        <div className="flex flex-col gap-0.5">
          <span className="font-bold">
            {faDigits(s.price_toman)} تومان{s.per_meter && " (هر متر)"}
          </span>
          <span className="text-muted-foreground">{priceAge(s.price_age_days)}</span>
        </div>
      ),
  ],
  ["آخرین قیمت", () => <NotRecorded text="هنوز استعلام نشده" />],
  ["فاصله و زمان", (s) => s.distance_m !== null && s.travel_min !== null && `${distance(s.distance_m)}، ${faDigits(s.travel_min)} دقیقه`],
  [
    "باز در زمان رسیدن",
    (s) => s.open_at_arrival !== null && `${s.open_at_arrival ? "باز" : "بسته"} در ${faText(s.arrival_at.slice(11, 16))}`,
  ],
  ["گارانتی", (s) => warranty(s.warranty)],
  [
    "پرداخت و اقساط",
    (s) =>
      s.payment_options.length > 0 &&
      s.payment_options.map((p) => `${p.provider} (${p.channel === "in_person" ? "حضوری" : "نحوه پرداخت نامشخص"})`).join("، "),
  ],
  ["ارسال سریع", (s) => DELIVERY[s.fast_delivery]],
  ["اعتبار قیمت", (s) => s.trust_level === "listed" && <Badge variant="secondary">ثبت‌شده</Badge>],
];

// the visit plan for the compared shops; the brief's visit time, else now, is when the trip starts
function planLink(b: Brief, shopIds: string[]) {
  if (!b.origin) return null;
  const { lat, lon, mode, arrival } = params(b);
  const q = new URLSearchParams(shopIds.map((id) => ["shop_id", id]));
  q.set("lat", String(lat));
  q.set("lon", String(lon));
  q.set("mode", mode ?? "walk");
  q.set("depart_at", arrival ?? new Date().toISOString());
  return `/plan?${q}`;
}

// buttons do not wrap by default, which overflows a narrow column
const WRAP = "h-auto whitespace-normal py-1";

type State = { status: "loading" } | { status: "error" } | { status: "missing" } | { status: "done"; compare: Compare };

export function SellerCompare({ productId, offerIds }: { productId: string; offerIds: string[] }) {
  const { session } = useBrief();
  const [state, setState] = useState<State>({ status: "loading" });
  // refetch only when a brief field the compare reads changes
  const key = session && JSON.stringify(params(session.brief));
  const ids = offerIds.join();

  useEffect(() => {
    if (key === null) return;
    compareSellers(productId, ids.split(","), JSON.parse(key)).then(
      (compare) => setState(compare ? { status: "done", compare } : { status: "missing" }),
      () => setState({ status: "error" }),
    );
  }, [productId, ids, key]);

  if (state.status === "loading") return <p className="text-sm text-muted-foreground">در حال بارگذاری...</p>;
  if (state.status === "error") return <p className="text-sm text-destructive">مقایسه دریافت نشد. دوباره تلاش کنید.</p>;
  if (state.status === "missing") return <p className="text-sm text-muted-foreground">فروشنده‌های انتخاب‌شده پیدا نشدند.</p>;

  const { compare } = state;
  const plan = session && planLink(session.brief, [...new Set(compare.sellers.map((s) => s.shop_id))]);
  return (
    <article className="flex flex-col gap-3">
      <h1 className="text-lg font-bold leading-7">مقایسه فروشنده‌ها</h1>
      <p className="text-sm">{compare.title}</p>
      <div className="overflow-x-auto">
        <table className="w-full table-fixed text-xs">
          <thead>
            <tr className="border-b">
              <td className="w-20" />
              {compare.sellers.map((s) => (
                <th key={s.offer_id} scope="col" className="p-1.5 text-start align-top">
                  <Link href={`/shops/${s.shop_id}`} className="font-semibold text-primary underline-offset-4 hover:underline">
                    {s.shop_name}
                  </Link>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ROWS.map(([label, cell]) => (
              <tr key={label} className="border-b">
                <th scope="row" className="py-2 text-start align-top font-normal text-muted-foreground">
                  {label}
                </th>
                {compare.sellers.map((s) => (
                  <td key={s.offer_id} className="p-1.5 align-top break-words">
                    {cell(s) || <NotRecorded />}
                  </td>
                ))}
              </tr>
            ))}
            <tr>
              <th scope="row" className="py-2 text-start align-top font-normal text-muted-foreground">
                قدم بعدی
              </th>
              {compare.sellers.map((s) => (
                <td key={s.offer_id} className="p-1.5 align-top">
                  <div className="flex flex-col gap-1.5">
                    {/* shortcut: disabled until the Seller Liaison sends inquiries */}
                    <Button size="xs" disabled title="استعلام به‌زودی" className={WRAP}>
                      پرسیدن از فروشنده
                    </Button>
                    <Link href={`/shops/${s.shop_id}`} className={buttonVariants({ variant: "outline", size: "xs", className: WRAP })}>
                      دیدن فروشگاه
                    </Link>
                  </div>
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground">
        زمان رسیدن با فرض خط مستقیم و {MODES[compare.travel_mode]} تخمین زده شده است.
      </p>
      {plan ? (
        <Link href={plan} className={buttonVariants({ size: "lg", className: "self-center" })}>
          برنامه مراجعه
        </Link>
      ) : (
        <p className="text-xs text-muted-foreground">برای برنامه مراجعه، مبدأ را در خلاصه خرید انتخاب کنید.</p>
      )}
    </article>
  );
}
