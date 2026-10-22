"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { MODES } from "@/components/brief-bar";
import { SellerMap, type Pin } from "@/components/seller-map";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { getVisitPlan, type Directions, type Stop, type VisitPlan as Plan } from "@/lib/api";
import { distance, faDigits, faText } from "@/lib/format";

// times come in Tehran's fixed +03:30 offset, so the clock time is read off the string
export const clock = (iso: string) => faText(iso.slice(11, 16));

const day = (iso: string) =>
  new Date(iso).toLocaleDateString("fa-IR-u-ca-persian", { timeZone: "Asia/Tehran", weekday: "long", day: "numeric", month: "long" });

export function OpenBadge({ open }: { open: boolean | null }) {
  if (open === null) return <Badge variant="outline" className="text-muted-foreground">ساعت کاری ثبت نشده</Badge>;
  return open ? <Badge variant="secondary">باز در زمان رسیدن</Badge> : <Badge variant="destructive">بسته در زمان رسیدن</Badge>;
}

// the last leg, inside the pasaj: "پاساژ علاالدین، نبش ...، طبقه ۲، واحد ۲۱۶"
function lastLeg({ pasaj, landmark, floor, unit }: Stop["last_leg"]) {
  const inside = [floor && `طبقه ${floor}`, unit && `واحد ${unit}`].filter(Boolean);
  const parts = [pasaj && `پاساژ ${pasaj}`, landmark, ...(inside.length ? inside : ["طبقه و واحد ثبت نشده"])];
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
            className={buttonVariants({ size: "xs", variant: "outline" })}
          >
            {name}
          </a>
        ))}
        <Link href={`/shops/${d.shop_id}`} className={buttonVariants({ size: "xs", variant: "ghost" })}>
          صفحه فروشگاه
        </Link>
      </div>
    </>
  );
}

type State = { status: "loading" } | { status: "error" } | { status: "missing" } | { status: "done"; plan: Plan };

export function VisitPlan({ query }: { query: string }) {
  const [state, setState] = useState<State>({ status: "loading" });
  const [selected, setSelected] = useState<string | null>(null);
  const [shared, setShared] = useState(false);

  useEffect(() => {
    getVisitPlan(query).then(
      (plan) => setState(plan ? { status: "done", plan } : { status: "missing" }),
      () => setState({ status: "error" }),
    );
  }, [query]);

  const pins = useMemo(() => (state.status === "done" ? planPins(state.plan.stops) : []), [state]);

  if (state.status === "loading") return <p className="text-sm text-muted-foreground">در حال بارگذاری...</p>;
  if (state.status === "error") return <p className="text-sm text-destructive">برنامه مراجعه دریافت نشد. دوباره تلاش کنید.</p>;
  if (state.status === "missing") return <p className="text-sm text-muted-foreground">فروشگاه‌های این برنامه پیدا نشدند.</p>;

  const { plan } = state;
  const pinOf = (s: Stop) => pins.find((p) => p.rows.includes(s))?.key;
  const share = async () => {
    // the page's own link is the plan: it has no controls that change it
    await navigator.clipboard.writeText(location.href);
    setShared(true);
  };

  return (
    <article className="flex flex-col gap-3">
      <header className="flex flex-col gap-1">
        <h1 className="text-lg font-bold leading-7">برنامه مراجعه</h1>
        <p className="text-sm text-muted-foreground">
          حرکت {day(plan.depart_at)} ساعت {clock(plan.depart_at)}، {MODES[plan.mode]}
        </p>
      </header>

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
              <span className="font-semibold">{s.shop_name}</span>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <span>رسیدن {clock(s.eta)}</span>
              <OpenBadge open={s.open_at_eta} />
            </div>
            <RouteDetails d={s} />
          </li>
        ))}
      </ol>

      <Button onClick={share} className="self-center">
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
