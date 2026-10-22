"use client";

import Link from "next/link";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";

import { Choices } from "@/components/brief-bar";
import { useBrief } from "@/components/brief-provider";
import { CompareToggle } from "@/components/compare-tray";
import { InquiryTracker } from "@/components/inquiry-tracker";
import { pasajHref } from "@/components/pasaj-view";
import { pinKey, pins, SellerMap } from "@/components/seller-map";
import { RouteDetails } from "@/components/visit-plan";

import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  composeInquiries,
  confirmInquiries,
  getDirections,
  inquiriesStreamUrl,
  type Condition,
  type Directions,
  type InquiryStatus,
  type Reason,
  type SellerRow,
} from "@/lib/api";
import { distance, faDigits, faText, priceAge } from "@/lib/format";
import { useEventStream } from "@/lib/use-event-stream";

const UNKNOWN: Record<Condition, string> = {
  hours: "ساعت کاری",
  payment: "روش پرداخت",
  warranty: "گارانتی",
  test_in_presence: "تست در حضور مشتری",
  fast_delivery: "ارسال سریع",
};

// underlined without hover, so a touch screen shows the shop page is a tap away
const SHOP_LINK = "font-semibold text-primary underline underline-offset-4";

const COVERAGE = "داده‌ها بخشی از فروشگاه‌های تهران، بیشتر مرکز شهر، را پوشش می‌دهند.";

function reasonLabel(r: Reason) {
  switch (r.kind) {
    case "closest":
      return "نزدیک‌ترین";
    case "cheapest":
      return "ارزان‌ترین";
    case "open_now":
      return "الان باز است";
    case "installments":
      return `اقساط ${r.provider}`;
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

type RouteState = null | "loading" | "no_origin" | "error" | Directions;

// a card's action row; the route to the shop opens under it and needs the brief's origin
function Actions({ shopId, children }: { shopId: string; children?: ReactNode }) {
  const { session } = useBrief();
  const [route, setRoute] = useState<RouteState>(null);
  function toggle() {
    if (route !== null) return setRoute(null);
    if (!session?.brief.origin) return setRoute("no_origin");
    setRoute("loading");
    getDirections(shopId, session.brief.origin, session.brief.travel_mode ?? "walk").then(
      (d) => setRoute(d ?? "error"),
      () => setRoute("error"),
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {children}
      <Button variant="outline" size="sm" aria-expanded={route !== null} onClick={toggle}>
        مسیر
      </Button>
      {route !== null && (
        <div className="flex basis-full flex-col gap-1.5 text-sm">
          {route === "loading" ? (
            <p className="text-muted-foreground">در حال بارگذاری...</p>
          ) : route === "no_origin" ? (
            <p className="text-muted-foreground">برای مسیر، مبدأ را در خلاصه خرید انتخاب کنید.</p>
          ) : route === "error" ? (
            <p className="text-destructive">مسیر دریافت نشد. دوباره تلاش کنید.</p>
          ) : (
            <RouteDetails d={route} />
          )}
        </div>
      )}
    </div>
  );
}

export function Seller({ s, children }: { s: SellerRow; children?: ReactNode }) {
  return (
    <Card className="gap-1.5 p-3">
      <div className="flex items-start justify-between gap-2">
        <Link href={`/shops/${s.shop_id}`} className={SHOP_LINK}>
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
            <span>آخرین تغییر قیمت: {priceAge(s.price_age_days)}</span>
            {s.price_age_bucket === ">30" && <span className="text-amber-700">قیمت قدیمی، استعلام بگیرید</span>}
          </>
        ) : (
          <Badge variant="outline" className="text-muted-foreground">
            ثبت نشده
          </Badge>
        )}
      </div>
      {s.payment_options.length > 0 && (
        <p className="text-xs">
          اقساط: {s.payment_options.map((p) => `${p.provider} (${p.channel === "in_person" ? "حضوری" : "نحوه پرداخت نامشخص"})`).join("، ")}
        </p>
      )}
      {s.unknown.length > 0 && <p className="text-xs text-muted-foreground">ثبت نشده: {s.unknown.map((c) => UNKNOWN[c]).join("، ")}</p>}
      {s.reasons.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {s.reasons.map((r) => (
            <Badge key={r.kind} variant="outline">
              {reasonLabel(r)}
            </Badge>
          ))}
        </div>
      )}
      {children}
    </Card>
  );
}

export function SellerList({ productId }: { productId: string }) {
  const { session, pending, error, patch } = useBrief();
  const sid = session?.session_id ?? null;
  const tracked = useEventStream<InquiryStatus>(sid && inquiriesStreamUrl(sid));
  const inquiries = (tracked?.inquiries ?? []).filter((i) => i.product_id === productId);
  const [askError, setAskError] = useState(false);
  const trackerRef = useRef<HTMLDivElement>(null);
  // a draft only: the tracker below asks for consent before anything reaches the seller
  async function ask(offerId: string) {
    try {
      await composeInquiries(sid!, [offerId]);
      setAskError(false);
    } catch {
      setAskError(true);
    }
    trackerRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  // offers picked for the seller compare
  const compareMax = 3;
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const compareToggle = (id: string) => (
    <CompareToggle
      on={compareIds.includes(id)}
      full={compareIds.length >= compareMax}
      onToggle={() => setCompareIds((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]))}
    />
  );
  const actions = (s: SellerRow) => {
    const asked = !!s.inquiry || inquiries.some((i) => i.shop_id === s.shop_id);
    return (
      <Actions shopId={s.shop_id}>
        <Button size="sm" disabled={!sid || asked} onClick={() => ask(s.offer_id)}>
          {asked ? "استعلام شد" : "پرسیدن از فروشنده"}
        </Button>
        {compareToggle(s.offer_id)}
      </Actions>
    );
  };

  // entering this step keeps the brief; the response carries this product's sellers filtered by it
  useEffect(() => {
    patch({ step: { kind: "sellers", product_id: productId } });
  }, [productId, patch]);

  const step = session?.step;
  const results = session?.results;
  const list = step?.kind === "sellers" && step.product_id === productId && results && "sellers" in results ? results : null;

  // view and selected pin live here, so switching views keeps both; filters live in the brief
  const [view, setView] = useState<"list" | "map">("list");
  const [selected, setSelected] = useState<string | null>(null);
  const rows = useMemo(() => (list ? [...list.sellers, ...list.ask_them] : []), [list]);
  const mapPins = useMemo(() => pins(rows), [rows]);
  const picked = mapPins.find((p) => p.key === selected);
  const showMap = view === "map" && rows.length > 0;
  const unplaced = rows.length - mapPins.reduce((t, p) => t + p.rows.length, 0);
  // rows of the pin picked on the map
  const pickedClass = "rounded-xl aria-[current=true]:ring-2 aria-[current=true]:ring-primary";

  if (list === null) {
    if (error && !pending) return <p className="text-sm text-destructive">فهرست فروشنده‌ها دریافت نشد. دوباره تلاش کنید.</p>;
    return <p className="text-sm text-muted-foreground">در حال بارگذاری...</p>;
  }

  const nearest = list.nearest_covered;

  return (
    <article className="flex flex-col gap-4">
      <h1 className="text-lg font-bold leading-7">{list.title}</h1>

      <p className="text-sm" aria-live="polite">
        {pending ? "در حال به‌روزرسانی..." : `${faDigits(list.count + list.ask_them.length)} فروشنده`}
      </p>

      {rows.length > 0 && <Choices label="نمایش فروشنده‌ها" options={{ list: "فهرست", map: "نقشه" }} value={view} onPick={setView} />}

      {showMap && (
        <section className="flex flex-col gap-3">
          <SellerMap pins={mapPins} selected={selected} onSelect={setSelected} />
          {unplaced > 0 && (
            <p className="text-xs text-muted-foreground">
              {faDigits(unplaced)} فروشنده موقعیت ثبت‌شده ندارد و فقط در فهرست است.
            </p>
          )}
          {picked ? (
            <section aria-labelledby="picked" className="flex flex-col gap-2">
              <h2 id="picked" className="text-sm font-semibold">
                {picked.label}
              </h2>
              {picked.rows[0].pasaj && (
                <Link href={pasajHref(picked.rows[0].pasaj, productId)} className={`${SHOP_LINK} text-sm`}>
                  همه فروشگاه‌های این پاساژ
                </Link>
              )}
              <ul className="flex flex-col gap-3">
                {picked.rows.map((s) => (
                  <li key={s.offer_id}>
                    <Seller s={s}>{actions(s)}</Seller>
                  </li>
                ))}
              </ul>
            </section>
          ) : (
            <p className="text-xs text-muted-foreground">روی یک نقطه بزنید تا فروشگاه‌های آن را ببینید.</p>
          )}
        </section>
      )}

      {showMap ? null : list.count === 0 && nearest === null ? (
        <p className="rounded-lg border p-3 text-sm">فروشنده‌ای با همه شرایط شما پیدا نشد. شرایط را در نوار بالا تغییر دهید.</p>
      ) : list.count === 0 ? (
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
            <li key={s.offer_id} aria-current={pinKey(s) === selected || undefined} className={pickedClass}>
              <Seller s={s}>{actions(s)}</Seller>
            </li>
          ))}
        </ul>
      )}

      {!showMap && list.ask_them.length > 0 && (
        <section aria-labelledby="ask-them" className="flex flex-col gap-2">
          <h2 id="ask-them" className="text-sm font-semibold">
            از فروشنده بپرسید
          </h2>
          <p className="text-xs text-muted-foreground">این فروشگاه‌ها بعضی از شرایط شما را ثبت نکرده‌اند.</p>
          <ul className="flex flex-col gap-3">
            {list.ask_them.map((s) => (
              <li key={s.offer_id} aria-current={pinKey(s) === selected || undefined} className={pickedClass}>
                <Seller s={s}>{actions(s)}</Seller>
              </li>
            ))}
          </ul>
        </section>
      )}

      {!showMap && list.category_only.length > 0 && (
        <section aria-labelledby="category-only" className="flex flex-col gap-2">
          <h2 id="category-only" className="text-sm font-semibold">
            فروشگاه‌های هم‌دسته
          </h2>
          <p className="text-xs text-muted-foreground">این فروشگاه‌ها این کالا را ثبت نکرده‌اند؛ فقط در همین دسته فعالیت دارند.</p>
          <ul className="flex flex-col gap-2">
            {list.category_only.map((s) => (
              <li key={s.shop_id} className="flex flex-col gap-1 rounded-lg border p-3 text-sm">
                <Link href={`/shops/${s.shop_id}`} className={SHOP_LINK}>
                  {s.shop_name}
                </Link>
                <span className="text-xs text-muted-foreground">{place(s)}</span>
                <Badge variant="outline" className="self-start text-muted-foreground">
                  فقط دسته فعالیت - موجودی نامشخص
                </Badge>
                <Actions shopId={s.shop_id} />
              </li>
            ))}
          </ul>
        </section>
      )}

      <div ref={trackerRef} className="scroll-mt-32">
        {askError && <p className="text-sm text-destructive">پیش‌نویس ساخته نشد. برای هر کالا حداکثر ۳ استعلام باز می‌ماند.</p>}
        {sid && <InquiryTracker sessionId={sid} inquiries={inquiries} onConfirm={(ids) => confirmInquiries(sid, ids)} />}
      </div>

      {/* bottom-18: above the collapsed agent sheet */}
      {compareIds.length >= 2 && (
        <Link
          href={`/products/${productId}/sellers/compare?${new URLSearchParams(compareIds.map((id) => ["offer", id]))}`}
          className={buttonVariants({ size: "lg", className: "sticky bottom-18 self-center shadow-md" })}
        >
          مقایسه فروشنده‌ها ({faDigits(compareIds.length)})
        </Link>
      )}
    </article>
  );
}
