"use client";

import Link from "next/link";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "cn";

import { useBrief } from "@/components/brief-provider";
import { clock, FELL_THROUGH, InquiryTracker, withAlternatives } from "@/components/inquiry-tracker";
import { pasajHref } from "@/components/pasaj-view";
import { pinKey, pins, SellerMap } from "@/components/seller-map";
import { RouteDetails } from "@/components/visit-plan";

import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  composeInquiries,
  confirmInquiries,
  getDirections,
  inquiriesStreamUrl,
  type Condition,
  type Directions,
  type InquiryStatus,
  type SellerRow,
} from "@/lib/api";
import { distance, faDigits, faText, localDate, openLabel, priceAge, toman, UNKNOWN } from "@/lib/format";
import { sellerReasons } from "@/lib/reasons";
import { useEventStream } from "@/lib/use-event-stream";

const CONDITION: Record<Condition, string> = {
  hours: "ساعت کاری",
  payment: "روش پرداخت",
  warranty: "گارانتی",
  test_in_presence: "تست در حضور مشتری",
  fast_delivery: "ارسال سریع",
};

const SHOP_LINK = "-my-2.5 py-2.5 font-semibold text-primary underline underline-offset-4";

const CATEGORY_SHOWN = 10;

const COVERAGE = "داده‌ها بخشی از فروشگاه‌های تهران، بیشتر مرکز شهر، را پوشش می‌دهند.";

function place(s: { area: string | null; pasaj: string | null; floor?: string | null; unit?: string | null; distance_m: number | null }) {
  const parts = [
    s.pasaj ? `پاساژ ${s.pasaj}` : s.area,
    s.floor && `طبقه ${s.floor}`,
    s.unit && `واحد ${s.unit}`,
  ].filter(Boolean);
  const text = faText(parts.join("، ") || `مکان: ${UNKNOWN}`);
  return s.distance_m === null ? text : `${text} · ${distance(s.distance_m)}`;
}

// whole days from an ISO time's date to today
const daysSince = (at: string) => Math.max(0, Math.round((Date.parse(localDate()) - Date.parse(at.slice(0, 10))) / 864e5));

export const TRUST_CLASS = { confirmed: "bg-trust-confirmed text-trust-foreground", website: "bg-trust-website text-trust-foreground" };

// the price slot: the seller's confirmed price, else the website price, else the listed one
function shownPrice(s: SellerRow): { toman: number | null; trust: "confirmed" | "website" | "listed"; source: string; days: number | null } {
  const lp = s.latest_price;
  if (lp?.price_toman != null && lp.at && (lp.status === "confirmed" || lp.status === "website")) {
    const at = `ساعت ${clock(lp.at)}`;
    return {
      toman: lp.price_toman,
      trust: lp.status,
      source: lp.status === "confirmed" ? `قیمت فروشنده، ${at}` : `قیمت سایت فروشنده، ${at}، موجودی تأیید نشده`,
      days: daysSince(lp.at),
    };
  }
  return { toman: s.price_toman, trust: "listed", source: s.per_meter ? "قیمت ثبت‌شده، هر متر" : "قیمت ثبت‌شده", days: s.price_age_days };
}

function availability(i: SellerRow["inquiry"]) {
  if (!i) return UNKNOWN;
  if (i.available === "yes") return "موجود است";
  if (i.available === "no" || i.status === "unavailable") return "ناموجود";
  if (i.status === "no_reply") return "پاسخ نداد";
  if (i.status === "closed") return "الان بسته است";
  if (i.status === "sent" || i.status === "queued") return "در انتظار پاسخ";
  return UNKNOWN;
}

// payment as words, e.g. "ترب‌پی حضوری"
const payment = (s: SellerRow) => s.payment_options.map((p) => (p.channel === "in_person" ? `${p.provider} حضوری` : p.provider)).join("، ");

type RouteState = null | "loading" | "no_origin" | "error" | Directions;

// a card's action row; the route to the shop opens under it and needs the brief's origin.
// `routeFirst`: the route is the card's one filled action
function Actions({ shopId, routeFirst = false, children }: { shopId: string; routeFirst?: boolean; children?: ReactNode }) {
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
  const routeButton = (
    <Button variant={routeFirst ? "contact" : "ghost"} size="row" className={routeFirst ? "flex-1" : "px-2"} aria-expanded={route !== null} onClick={toggle}>
      {routeFirst ? "مسیر تا فروشگاه" : "مسیر"}
    </Button>
  );
  return (
    <div className="flex flex-wrap items-center gap-1">
      {routeFirst && routeButton}
      {children}
      {!routeFirst && routeButton}
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

function OpenNow({ open }: { open: boolean | null }) {
  if (open === null) return <span>{openLabel(open)}</span>;
  if (!open) return <span className="text-closed">{openLabel(open)}</span>;
  return (
    <span className="inline-flex items-center gap-1 text-foreground">
      <span aria-hidden className="size-2 rounded-full bg-open" />
      {openLabel(open)}
    </span>
  );
}

// ResultCard: one reason badge, price / age / availability slots, then the actions passed as children
export function Seller({ s, reason, children }: { s: SellerRow; reason?: string; children?: ReactNode }) {
  const price = shownPrice(s);
  const confirmed = s.latest_price?.status === "confirmed" ? s.latest_price.price_toman : null;
  const available = availability(s.inquiry);
  return (
    <Card className="gap-2 p-4">
      <div className="flex items-start justify-between gap-2">
        <Link href={`/shops/${s.shop_id}`} className="text-base leading-7 font-bold">
          {s.shop_name}
        </Link>
        <Badge variant="secondary" className="rounded-full font-bold">
          {reason ?? sellerReasons([s], { priority: "cheapest", payment: { kind: "any", provider: null } })[0]}
        </Badge>
      </div>
      <p className="text-xs leading-5 text-muted-foreground">
        {[place(s), payment(s)].filter(Boolean).join(" · ")} · <OpenNow open={s.open_now} />
      </p>
      <div data-slot="price" className="flex flex-wrap items-baseline justify-between gap-x-2">
        {price.toman === null ? (
          <span className="text-base leading-7 font-bold text-muted-foreground">قیمت: {UNKNOWN}</span>
        ) : (
          <>
            <span className="text-base leading-7 font-bold tabular-nums">{toman(price.toman)}</span>
            <Badge
              variant={price.trust === "listed" ? "secondary" : "default"}
              className={cn("h-auto py-0.5 whitespace-normal", price.trust !== "listed" && TRUST_CLASS[price.trust])}
            >
              {price.source}
            </Badge>
          </>
        )}
      </div>
      {price.toman !== null && price.days !== null && price.days > 30 && (
        <p className="text-xs leading-5 text-notice-foreground">قیمت قدیمی، استعلام بگیرید</p>
      )}
      <div className="grid grid-cols-2 divide-x divide-hairline rounded-lg border border-hairline text-xs leading-5">
        <div data-slot="age" className="flex flex-col px-3 py-1.5">
          <span className="text-muted-foreground">آخرین تغییر قیمت</span>
          <span className={cn("text-sm tabular-nums", price.days === null ? "text-muted-foreground" : price.days > 30 && "text-notice-foreground")}>
            {priceAge(price.days)}
          </span>
        </div>
        <div data-slot="availability" className="flex flex-col px-3 py-1.5">
          <span className="text-muted-foreground">موجودی</span>
          <span className={cn("text-sm", available === UNKNOWN ? "text-muted-foreground" : available === "موجود است" && "font-bold text-confirmed-foreground")}>
            {available}
          </span>
        </div>
      </div>
      {confirmed !== null && s.price_toman !== null && confirmed !== s.price_toman && (
        <p className="text-xs leading-5 text-muted-foreground">قیمت ثبت‌شده {toman(s.price_toman)} بود. پاسخ فروشنده شبیه‌سازی است.</p>
      )}
      {s.unknown.length > 0 && (
        <p className="text-xs text-muted-foreground">
          {UNKNOWN}: {s.unknown.map((c) => CONDITION[c]).join("، ")}
        </p>
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
  // the tracker also follows alternatives asked from here, which may be for a similar product
  const followed = withAlternatives(tracked?.inquiries ?? [], (i) => i.product_id === productId);
  const [askError, setAskError] = useState(false);
  const trackerRef = useRef<HTMLDivElement>(null);
  const toTracker = () => trackerRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  // a draft only: the tracker below asks for consent before anything reaches the seller
  async function ask(offerIds: string[]) {
    try {
      await composeInquiries(sid!, offerIds);
      setAskError(false);
    } catch {
      setAskError(true);
    }
    toTracker();
  }
  // offers picked for the seller compare
  const compareMax = 3;
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const compareToggle = (id: string) => {
    const on = compareIds.includes(id);
    return (
      <Button
        variant="ghost"
        size="row"
        className="ms-auto px-2 font-normal"
        aria-pressed={on}
        disabled={!on && compareIds.length >= compareMax}
        onClick={() => setCompareIds((p) => (on ? p.filter((x) => x !== id) : [...p, id]))}
      >
        <span aria-hidden className={cn("size-4 rounded border border-border", on && "border-primary bg-primary")} />
        مقایسه
      </Button>
    );
  };
  const mine = (s: SellerRow) => inquiries.find((i) => i.shop_id === s.shop_id);
  // one filled action per card, by the inquiry's state
  const actions = (s: SellerRow) => {
    const i = s.inquiry;
    if (i?.available === "yes")
      return (
        <Actions shopId={s.shop_id} routeFirst>
          {compareToggle(s.offer_id)}
        </Actions>
      );
    const draft = mine(s);
    let primary;
    if (i && (i.available === "no" || FELL_THROUGH.includes(i.status)))
      primary = (
        <Button variant="outline" size="row" onClick={toTracker}>
          جایگزین‌ها
        </Button>
      );
    else if (i || draft) {
      const sentAt = draft?.events.find((e) => e.status === "sent")?.at;
      primary = (
        <Button variant="secondary" size="row" disabled>
          {draft?.status === "draft" ? "پیش‌نویس استعلام آماده است" : sentAt ? `استعلام فرستاده شد، ${clock(sentAt)}` : "استعلام فرستاده شد"}
        </Button>
      );
    } else
      primary = (
        <Button variant="contact" size="row" disabled={!sid} onClick={() => ask([s.offer_id])}>
          استعلام بگیرید
        </Button>
      );
    return (
      <Actions shopId={s.shop_id}>
        {primary}
        {compareToggle(s.offer_id)}
      </Actions>
    );
  };

  // a seller reply adds an event; patching the step again refetches the cards with the confirmed price
  const replies = inquiries.map((i) => i.events.length).join();
  // entering this step keeps the brief; the response carries this product's sellers filtered by it
  useEffect(() => {
    patch({ step: { kind: "sellers", product_id: productId } });
  }, [productId, patch, replies]);

  const step = session?.step;
  const results = session?.results;
  const list = step?.kind === "sellers" && step.product_id === productId && results && "sellers" in results ? results : null;

  // view and selected pin live here, so switching views keeps both; filters live in the brief
  const [view, setView] = useState<"list" | "map">("list");
  const [selected, setSelected] = useState<string | null>(null);
  const [moreCategory, setMoreCategory] = useState(false);
  const rows = useMemo(() => (list ? [...list.sellers, ...list.ask_them] : []), [list]);
  const brief = session?.brief;
  const reasons = useMemo(() => {
    const labels = brief ? sellerReasons(rows, brief) : [];
    return new Map(rows.map((s, n) => [s.offer_id, labels[n]]));
  }, [rows, brief]);
  const mapPins = useMemo(() => pins(rows), [rows]);
  const picked = mapPins.find((p) => p.key === selected);
  const showMap = view === "map" && rows.length > 0;
  const unplaced = rows.length - mapPins.reduce((t, p) => t + p.rows.length, 0);
  // rows of the pin picked on the map
  const pickedClass = "rounded-xl aria-[current=true]:ring-2 aria-[current=true]:ring-primary";
  const dockRow = useRef<HTMLUListElement>(null);
  // a pin tap brings that shop's card fully into the docked row
  const pick = useCallback((key: string) => {
    setSelected(key);
    dockRow.current?.querySelector(`[data-pin="${CSS.escape(key)}"]`)?.scrollIntoView({ block: "nearest", inline: "start" });
  }, []);

  if (list === null) {
    if (error && !pending) return <p className="text-sm text-destructive">فهرست فروشنده‌ها دریافت نشد. دوباره تلاش کنید.</p>;
    return <p className="text-sm text-muted-foreground">در حال بارگذاری...</p>;
  }

  const nearest = list.nearest_covered;
  const card = (s: SellerRow) => (
    <Seller s={s} reason={reasons.get(s.offer_id)}>
      {actions(s)}
    </Seller>
  );
  // the dock asks the cheapest sellers not asked yet, or compares the picked ones
  const cheapest = rows
    .filter((s) => s.price_toman !== null && !s.inquiry && !mine(s))
    .sort((a, b) => a.price_toman! - b.price_toman!)
    .slice(0, 3);

  return (
    <article className="flex flex-col gap-3">
      <h1 className="text-base leading-7 font-bold">{list.title}</h1>

      <div className="flex items-center justify-between gap-2">
        <p className="text-sm" aria-live="polite">
          {pending ? "در حال به‌روزرسانی..." : `${faDigits(list.count + list.ask_them.length)} فروشنده`}
        </p>
        {rows.length > 0 && (
          <ToggleGroup
            aria-label="نمایش فروشنده‌ها"
            variant="outline"
            spacing={0}
            className="bg-card"
            value={[view]}
            onValueChange={(v) => v[0] && setView(v[0] as "list" | "map")}
          >
            {(["list", "map"] as const).map((v) => (
              <ToggleGroupItem key={v} value={v} className="aria-pressed:bg-primary! aria-pressed:text-primary-foreground!">
                {v === "list" ? "فهرست" : "نقشه"}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        )}
      </div>

      {showMap && (
        <section className="flex flex-col gap-2">
          <SellerMap pins={mapPins} selected={selected} onSelect={pick} />
          <ul ref={dockRow} aria-label="فروشنده‌های روی نقشه" className="relative z-10 -mt-16 flex snap-x snap-mandatory gap-2 overflow-x-auto px-2 pb-1">
            {mapPins.flatMap((p) =>
              p.rows.map((s) => (
                <li key={s.offer_id} data-pin={p.key} aria-current={p.key === selected || undefined} className={cn("w-[85%] shrink-0 snap-center", pickedClass)}>
                  {card(s)}
                </li>
              )),
            )}
          </ul>
          {unplaced > 0 && (
            <p className="text-xs text-muted-foreground">
              {faDigits(unplaced)} فروشنده موقعیت ثبت‌شده ندارد و فقط در فهرست است.
            </p>
          )}
          {picked?.rows[0].pasaj && (
            <Link href={pasajHref(picked.rows[0].pasaj, productId)} className={`${SHOP_LINK} text-sm`}>
              همه فروشگاه‌های این پاساژ
            </Link>
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
        <ul className="flex flex-col gap-2">
          {list.sellers.map((s) => (
            <li key={s.offer_id} aria-current={pinKey(s) === selected || undefined} className={pickedClass}>
              {card(s)}
            </li>
          ))}
        </ul>
      )}

      {!showMap && list.ask_them.length > 0 && (
        <section aria-labelledby="ask-them" className="flex flex-col gap-2">
          <h2 id="ask-them" className="text-sm font-semibold">
            از فروشنده بپرسید
          </h2>
          <p className="text-xs">این فروشگاه‌ها بعضی از شرایط شما را ثبت نکرده‌اند.</p>
          <ul className="flex flex-col gap-2">
            {list.ask_them.map((s) => (
              <li key={s.offer_id} aria-current={pinKey(s) === selected || undefined} className={pickedClass}>
                {card(s)}
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
          <p className="text-xs">این فروشگاه‌ها این کالا را ثبت نکرده‌اند؛ فقط در همین دسته فعالیت دارند.</p>
          <ul className="flex flex-col gap-2">
            {list.category_only.slice(0, moreCategory ? undefined : CATEGORY_SHOWN).map((s) => (
              <li key={s.shop_id} className="flex flex-col gap-1 rounded-xl bg-card p-4 text-sm">
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
          {!moreCategory && list.category_only.length > CATEGORY_SHOWN && (
            <Button variant="outline" size="row" onClick={() => setMoreCategory(true)}>
              نمایش {faDigits(list.category_only.length - CATEGORY_SHOWN)} فروشگاه دیگر
            </Button>
          )}
        </section>
      )}

      <div ref={trackerRef} className="scroll-mt-32">
        {askError && <p className="text-sm text-destructive">پیش‌نویس ساخته نشد. برای هر کالا حداکثر ۳ استعلام باز می‌ماند.</p>}
        {sid && <InquiryTracker sessionId={sid} inquiries={followed} onConfirm={(ids) => confirmInquiries(sid, ids)} />}
      </div>

      {/* bottom-18: above the collapsed agent sheet */}
      {compareIds.length >= 2 ? (
        <Link
          href={`/products/${productId}/sellers/compare?${new URLSearchParams(compareIds.map((id) => ["offer", id]))}`}
          className={buttonVariants({ variant: "buy", size: "row", className: "sticky bottom-18 w-full" })}
        >
          مقایسه {faDigits(compareIds.length)} فروشنده
        </Link>
      ) : (
        cheapest.length > 0 && (
          <Button variant="buy" size="row" className="sticky bottom-18 w-full" disabled={!sid} onClick={() => ask(cheapest.map((s) => s.offer_id))}>
            استعلام از {faDigits(cheapest.length)} فروشنده ارزان‌تر
          </Button>
        )
      )}
    </article>
  );
}
