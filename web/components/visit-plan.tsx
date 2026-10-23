"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { MODES } from "@/components/brief-bar";
import { FELL_THROUGH, STATUS } from "@/components/inquiry-tracker";
import { SellerMap, type Pin } from "@/components/seller-map";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { getVisitPlan, visitPlanStreamUrl, type ClosingNudge, type Directions, type PriceNudge, type Stop, type StopInquiry, type VisitPlan as Plan } from "@/lib/api";
import { distance, faDigits, faText, openLabel, UNKNOWN } from "@/lib/format";
import { useEventStream } from "@/lib/use-event-stream";
import { cn, linkClass } from "@/lib/utils";

// times come in Tehran's fixed +03:30 offset, so the clock time is read off the string
export const clock = (iso: string) => faText(iso.slice(11, 16));

const day = (iso: string) =>
  new Date(iso).toLocaleDateString("fa-IR-u-ca-persian", { timeZone: "Asia/Tehran", weekday: "long", day: "numeric", month: "long" });

export function OpenBadge({ open }: { open: boolean | null }) {
  if (open === null) return <Badge variant="outline" className="text-muted-foreground">{openLabel(null)}</Badge>;
  return open ? <Badge variant="secondary">باز در زمان رسیدن</Badge> : <Badge variant="destructive">بسته در زمان رسیدن</Badge>;
}

// the last leg, inside the pasaj: "پاساژ علاالدین، نبش ...، طبقه ۲، واحد ۲۱۶"
function lastLeg({ pasaj, landmark, floor, unit }: Stop["last_leg"]) {
  const inside = [floor && `طبقه ${floor}`, unit && `واحد ${unit}`].filter(Boolean);
  const parts = [pasaj && `پاساژ ${pasaj}`, landmark, ...(inside.length ? inside : [`طبقه و واحد: ${UNKNOWN}`])];
  return faText(parts.filter(Boolean).join("، "));
}

// consecutive stops in one pasaj share a pin, numbered by their first stop
function planPins(stops: Stop[]): Pin<Stop>[] {
  const out: Pin<Stop>[] = [];
  stops.forEach((s, i) => {
    const last = out.at(-1);
    if (s.last_leg.pasaj && last?.rows[0].last_leg.pasaj === s.last_leg.pasaj) last.rows.push(s);
    else out.push({ key: s.shop_id, label: s.last_leg.pasaj ? faText(`پاساژ ${s.last_leg.pasaj}`) : s.shop_name, lat: s.lat, lon: s.lon, rows: [s], text: faDigits(i + 1) });
  });
  return out;
}

// the stop's inquiry: confirmed badge and time, the seller's price against the listed one, the budget check
function StopInquiryLine({ i }: { i: StopInquiry }) {
  const delta = i.price_delta_toman;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {i.status === "confirmed" && i.replied_at ? (
        <Badge>تأیید شد ساعت {clock(i.replied_at)}</Badge>
      ) : (
        <Badge variant={FELL_THROUGH.includes(i.status) ? "destructive" : "outline"}>{STATUS[i.status]}</Badge>
      )}
      {i.latest_price_toman !== null ? (
        <span>
          {i.status === "confirmed" ? "قیمت تأییدشده" : "قیمت فروشنده"} {faDigits(i.latest_price_toman)} تومان
          {delta !== null && delta !== 0 && `، ${faDigits(Math.abs(delta))} تومان ${delta > 0 ? "گران‌تر" : "ارزان‌تر"} از قیمت ثبت‌شده`}
        </span>
      ) : (
        i.listed_price_toman !== null && <span>قیمت ثبت‌شده {faDigits(i.listed_price_toman)} تومان</span>
      )}
      {i.over_budget && <Badge variant="destructive">بیشتر از بودجه</Badge>}
    </div>
  );
}

// the route to one shop, on a plan stop and in the agent's directions block
export function RouteDetails({ d }: { d: Directions }) {
  return (
    <>
      <p className="text-muted-foreground">
        {distance(d.route.distance_m)}، {faDigits(d.route.duration_min)} دقیقه
        {d.route.source === "straight_line" && " (تخمین خط مستقیم)"}
      </p>
      <p>{lastLeg(d.last_leg)}</p>
      <div className="flex flex-wrap gap-1.5">
        {(
          [
            ["نشان", d.links.neshan],
            ["بلد", d.links.balad],
            ["گوگل مپ", d.links.google],
          ] as const
        ).map(([name, href]) => (
          <a
            key={name}
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`باز کردن در ${name}`}
            // cn drops the base border-transparent so the contact border shows
            className={cn(buttonVariants({ size: "tap", variant: "contact-outline" }))}
          >
            {name}
          </a>
        ))}
        <Link href={`/shops/${d.shop_id}`} className={linkClass}>
          صفحه فروشگاه
        </Link>
      </div>
    </>
  );
}

const weekday = (iso: string) => new Date(iso).toLocaleDateString("fa-IR", { timeZone: "Asia/Tehran", weekday: "long" });

// "پنجشنبه تا ۱۴ باز است؛ تا ۱۳:۱۵ حرکت کنید", with the swap as the same plan with that shop replaced
function NudgeLine({ n, query }: { n: ClosingNudge | PriceNudge; query: string }) {
  if (n.kind === "price") {
    const d = n.price_delta_toman;
    return (
      <>
        <span>
          {n.shop_name}: {n.trust_level === "confirmed" ? "قیمت تأییدشده" : "قیمت سایت فروشگاه"} {faDigits(n.latest_price_toman)} تومان،{" "}
          {faDigits(Math.abs(d))} تومان {d > 0 ? "گران‌تر" : "ارزان‌تر"} از قیمت ثبت‌شده
        </span>
        {n.over_budget ? <Badge variant="destructive">بیشتر از بودجه</Badge> : <Badge variant="secondary">در بودجه</Badge>}
      </>
    );
  }
  const swapped = (to: string) =>
    new URLSearchParams([...new URLSearchParams(query)].map(([k, v]) => [k, k === "shop_id" && v === n.shop_id ? to : v])).toString();
  return (
    <>
      <span>
        {n.shop_name} {weekday(n.closes_at)} تا {clock(n.closes_at)} باز است؛ تا {clock(n.leave_by)} حرکت کنید
      </span>
      {n.swap && (
        <Link href={`/plan?${swapped(n.swap.shop_id)}`} className={buttonVariants({ size: "xs", variant: "outline" })}>
          جایگزین: {n.swap.shop_name}
        </Link>
      )}
    </>
  );
}

type State ={ status: "loading" } | { status: "error" } | { status: "missing" } | { status: "done"; plan: Plan };

export function VisitPlan({ query }: { query: string }) {
  const [state, setState] = useState<State>({ status: "loading" });
  const [selected, setSelected] = useState<string | null>(null);
  const [shared, setShared] = useState(false);

  // with a session the plan follows its inquiries over the stream alone; without one it is fixed
  const stream = new URLSearchParams(query).has("session_id") ? visitPlanStreamUrl(query) : null;
  // a refused stream falls back to the one-time plan, which tells a missing plan from a failed one
  const [refused, setRefused] = useState(false);
  const live = useEventStream<Plan>(stream, setRefused);

  useEffect(() => {
    if (stream && !refused) return;
    getVisitPlan(query).then(
      (plan) => setState(plan ? { status: "done", plan } : { status: "missing" }),
      () => setState({ status: "error" }),
    );
  }, [query, stream, refused]);

  const current = live ?? (state.status === "done" ? state.plan : null);
  const pins = useMemo(() => (current ? planPins(current.stops) : []), [current]);

  if (state.status === "error") return <p className="text-sm text-destructive">برنامه مراجعه دریافت نشد. دوباره تلاش کنید.</p>;
  if (state.status === "missing") return <p className="text-sm text-muted-foreground">فروشگاه‌های این برنامه پیدا نشدند.</p>;
  if (!current) return <p className="text-sm text-muted-foreground">در حال بارگذاری...</p>;

  const plan = current;
  const pinOf = (s: Stop) => pins.find((p) => p.rows.includes(s))?.key;
  const share = async () => {
    // the page's link is the plan, without the session: the session id is the only key to its inquiries
    const link = new URL(location.href);
    link.searchParams.delete("session_id");
    await navigator.clipboard.writeText(link.href);
    setShared(true);
  };

  return (
    <article className="flex flex-col gap-3">
      <header className="flex flex-col gap-1">
        <p className="text-sm text-muted-foreground">
          حرکت {day(plan.depart_at)} ساعت {clock(plan.depart_at)}، {MODES[plan.mode]}
        </p>
      </header>

      {plan.nudges.length > 0 && (
        <section aria-label="هشدارها">
          <ul className="flex flex-col gap-2">
            {plan.nudges.map((n) => (
              <li
                key={`${n.kind}-${n.shop_id}-${n.kind === "price" ? n.product_id : ""}`}
                className="flex flex-wrap items-center gap-1.5 rounded-lg border border-amber-500 bg-amber-50 p-3 text-sm dark:bg-amber-950"
              >
                <NudgeLine n={n} query={query} />
              </li>
            ))}
          </ul>
        </section>
      )}

      <SellerMap pins={pins} selected={selected} onSelect={setSelected} />

      <ol className="flex flex-col gap-2">
        {plan.stops.map((s, i) => (
          <li
            key={s.shop_id}
            aria-current={pinOf(s) === selected}
            className="flex flex-col gap-1.5 rounded-lg border p-3 text-sm aria-[current=true]:border-amber-500"
          >
            <div className="flex items-center gap-2">
              <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs text-primary-foreground">
                {faDigits(i + 1)}
              </span>
              <span className="font-bold">{s.shop_name}</span>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <span>رسیدن {clock(s.eta)}</span>
              <OpenBadge open={s.open_at_eta} />
            </div>
            {s.inquiry && <StopInquiryLine i={s.inquiry} />}
            <RouteDetails d={s} />
          </li>
        ))}
      </ol>

      <Button variant="buy" onClick={share} className="self-center">
        اشتراک‌گذاری برنامه
      </Button>
      {shared && (
        <p role="status" className="text-center text-xs text-muted-foreground">
          پیوند برنامه کپی شد
        </p>
      )}
    </article>
  );
}
