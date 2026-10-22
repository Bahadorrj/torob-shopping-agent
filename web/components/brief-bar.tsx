"use client";

import { ChevronDown, SlidersHorizontal } from "lucide-react";
import { useEffect, useState } from "react";

import { useBrief } from "@/components/brief-provider";
import { Button } from "@/components/ui/button";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { Input } from "@/components/ui/input";
import type { Brief, Center, MustHave, PaymentKind, Priority, SessionPatch, TravelMode } from "@/lib/api";
import { distance, faDigits, faText, localDate, locate } from "@/lib/format";

const RADII = [500, 1000, 2000, 5000];
const BUDGETS = [2, 5, 10, 20].map((m) => m * 1000000);

const PRIORITIES: Record<Priority, string> = { cheapest: "ارزان‌ترین", closest: "نزدیک‌ترین", most_reliable: "معتبرترین" };
export const MODES: Record<TravelMode, string> = { walk: "پیاده", transit: "مترو و اتوبوس", car: "خودرو" };
const PAYMENTS: Record<PaymentKind, string> = { any: "هر روشی", cash: "نقدی", torob_pay: "ترب‌پی حضوری", installment: "اقساطی" };

const PROVIDERS = ["ترب‌پی", "اسنپ‌پی", "دیجی‌پی", "تارا", "ازکی‌وام"];
const MUST_HAVE: Record<keyof MustHave, string> = { warranty: "گارانتی", test_in_presence: "تست در حضور مشتری", fast_delivery: "ارسال سریع" };

type Sheet = "area" | "budget" | "all";
// another part of the page (home's pasaj list) opens the area sheet with this window event
export const OPEN_AREA = "pasazhgard:open-area";
const TITLES: Record<Sheet, string> = { area: "محدوده", budget: "بودجه", all: "فیلترها" };

const CHIP =
  "inline-flex h-9 shrink-0 items-center gap-1 whitespace-nowrap rounded-full border border-border bg-card px-3 text-sm text-foreground data-[on=true]:border-foreground data-[on=true]:font-bold data-[on=true]:shadow-[0_0_0_0.5px_var(--foreground)]";
// pressed: 1.5px of ink as a 1px border plus a 0.5px ring; Chrome floors border widths to whole pixels

function Chip({ on, toggle, ...props }: React.ComponentProps<"button"> & { on: boolean; toggle?: boolean }) {
  return <button type="button" data-on={on} aria-pressed={toggle ? on : undefined} className={CHIP} {...props} />;
}

function placeLabel(kind: "area" | "pasaj", name: string) {
  return kind === "area" ? name : `پاساژ ${faText(name)}`;
}

// `from` is the picked center the radius is drawn around; none means the user's own position
function radiusLabel(m: number, from: Center | undefined) {
  return from ? `${distance(m)} از ${placeLabel(from.kind, from.name)}` : `نزدیک من، ${distance(m)}`;
}

function areaLabel(area: Brief["area"], from: Center | undefined) {
  if (!area) return "همه مناطق";
  if (area.radius_m !== null) return radiusLabel(area.radius_m, from);
  return area.name ?? placeLabel("pasaj", area.pasaj ?? "");
}

function visitLabel(v: Brief["visit_window"]) {
  const day = v.date === null ? null : v.date === localDate() ? "امروز" : v.date === localDate(1) ? "فردا" : faText(v.date);
  const time = v.earliest_arrival && faText(v.earliest_arrival.slice(0, 5));
  return [day, time].filter(Boolean).join("، ") || "هر زمان";
}

function nowTime() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export function Choices<T extends string>({ label, options, value, onPick }: { label: string; options: Record<T, string>; value: T | null; onPick: (v: T) => void }) {
  return (
    <div className="flex flex-wrap gap-2" role="group" aria-label={label}>
      {(Object.keys(options) as T[]).map((k) => (
        <Button key={k} size="sm" variant={value === k ? "default" : "outline"} aria-pressed={value === k} onClick={() => onPick(k)}>
          {options[k]}
        </Button>
      ))}
    </div>
  );
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2" role="group" aria-label={label}>
      <p className="text-xs text-muted-foreground">{label}</p>
      <div className="flex flex-wrap gap-2">{children}</div>
    </div>
  );
}

// The brief as filter chips: one-tap toggles, plus bottom sheets for area, budget and everything else
export function FilterChipBar() {
  const { session, patch } = useBrief();
  const [sheet, setSheet] = useState<Sheet>("all");
  const [open, setOpen] = useState(false);
  const [geoError, setGeoError] = useState(false);
  useEffect(() => {
    const onOpen = () => {
      setSheet("area");
      setOpen(true);
    };
    window.addEventListener(OPEN_AREA, onOpen);
    return () => window.removeEventListener(OPEN_AREA, onOpen);
  }, []);
  if (!session) return null;
  const { brief, centers } = session;
  const set = (b: SessionPatch["brief"]) => patch({ brief: b });
  const { origin, visit_window: visit, payment, must_have } = brief;
  const center = origin ? centers.find((c) => c.lat === origin.lat && c.lon === origin.lon) : undefined;

  const show = (s: Sheet) => {
    setSheet(s);
    setOpen(true);
  };
  // a pick in the area or budget sheet closes it; the filters sheet stays open for more edits
  const done = () => sheet !== "all" && setOpen(false);

  async function pickOrigin(picked: Center | null) {
    if (picked) return set({ origin: { lat: picked.lat, lon: picked.lon } });
    try {
      const here = await locate();
      setGeoError(false);
      set({ origin: here });
    } catch {
      setGeoError(true);
    }
  }

  // geolocation first when a choice needs the origin; the origin is kept for later radius and distance use.
  // false when the position is unavailable
  async function withOrigin(b: NonNullable<SessionPatch["brief"]>) {
    if (brief.origin) {
      set(b);
      return true;
    }
    try {
      const origin = await locate();
      setGeoError(false);
      set({ ...b, origin });
      return true;
    } catch {
      setGeoError(true);
      // a ranking still works without the origin, a radius does not
      if (!("area" in b)) set(b);
      return false;
    }
  }

  async function pickArea(area: { radius_m: number } | { name: string } | { pasaj: string } | null) {
    if (area && "radius_m" in area) {
      if (!(await withOrigin({ area }))) return;
    } else set({ area });
    done();
  }

  const setBudget = (n: number | null) => {
    set({ budget: { ...brief.budget, max_total_toman: n } });
    done();
  };

  const nowOn = visit.earliest_arrival !== null;
  // an arrival already passed today is "now"; a later one names its time
  const nowLabel = !nowOn || (visit.date === localDate() && visit.earliest_arrival!.slice(0, 5) <= nowTime()) ? "الان باز" : visitLabel(visit);
  const pay = (k: PaymentKind) => set({ payment: { kind: payment.kind === k ? "any" : k, provider: null } });
  const active = [brief.area, brief.budget.max_total_toman, visit.date || visit.earliest_arrival, payment.kind !== "any", ...Object.values(must_have)].filter(Boolean).length;
  const area = areaLabel(brief.area, center);
  const budget = brief.budget.max_total_toman ? `تا ${faDigits(brief.budget.max_total_toman)} تومان` : null;

  const areaPanel = (
    <>
      <Group label={center ? "شعاع" : "نزدیک من"}>
        {RADII.map((r) => (
          <Chip key={r} on={brief.area?.radius_m === r} toggle onClick={() => pickArea({ radius_m: r })}>
            {radiusLabel(r, center)}
          </Chip>
        ))}
      </Group>
      <Group label="مرکز شعاع">
        <Chip on={!!origin && !center} toggle onClick={() => pickOrigin(null)}>
          مرکز: موقعیت من
        </Chip>
        {centers.map((c) => (
          <Chip key={`${c.kind}:${c.name}`} on={c === center} toggle onClick={() => pickOrigin(c)}>
            مرکز: {placeLabel(c.kind, c.name)}
          </Chip>
        ))}
      </Group>
      <Group label="محله">
        <Chip on={!brief.area} toggle onClick={() => pickArea(null)}>
          همه مناطق
        </Chip>
        {session.areas.map((a) => (
          <Chip key={a} on={brief.area?.name === a} toggle onClick={() => pickArea({ name: a })}>
            {a}
          </Chip>
        ))}
      </Group>
      <Group label="پاساژ">
        {session.pasajs.map((p) => (
          <Chip key={p} on={brief.area?.pasaj === p} toggle onClick={() => pickArea({ pasaj: p })}>
            {placeLabel("pasaj", p)}
          </Chip>
        ))}
      </Group>
    </>
  );

  const budgetPanel = (
    <>
      <Group label="سقف بودجه">
        <Chip on={!budget} toggle onClick={() => setBudget(null)}>
          بدون سقف
        </Chip>
        {BUDGETS.map((n) => (
          <Chip key={n} on={brief.budget.max_total_toman === n} toggle onClick={() => setBudget(n)}>
            {faDigits(n / 1000000)} میلیون
          </Chip>
        ))}
      </Group>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const n = Number(new FormData(e.currentTarget).get("budget"));
          setBudget(n > 0 ? n : null);
        }}
      >
        <Input
          name="budget"
          type="number"
          min={0}
          step={1000}
          defaultValue={brief.budget.max_total_toman ?? ""}
          aria-label="سقف بودجه به تومان"
          placeholder="سقف بودجه (تومان)"
          className="h-9"
        />
        <Button type="submit" className="h-9" aria-label="اعمال بودجه">
          اعمال
        </Button>
      </form>
    </>
  );

  return (
    <section aria-label="خلاصه خرید" className="sticky top-0 z-10 border-b border-hairline bg-card">
      <div data-chip-row className="mx-auto flex h-[52px] w-full max-w-xl items-center gap-2 overflow-x-auto px-4 [scrollbar-width:none]">
        <Chip on={active > 0} aria-haspopup="dialog" aria-label={active ? `فیلترها، ${faDigits(active)} فعال` : "فیلترها"} onClick={() => show("all")}>
          <SlidersHorizontal className="size-4" aria-hidden />
          فیلترها
          {active > 0 && (
            <span className="flex size-5 items-center justify-center rounded-full bg-foreground text-xs text-background tabular-nums">{faDigits(active)}</span>
          )}
        </Chip>
        <Chip on={!!brief.area} aria-haspopup="dialog" aria-label={`محدوده: ${area}`} onClick={() => show("area")}>
          {brief.area ? area : "محدوده"}
          <ChevronDown className="size-4" aria-hidden />
        </Chip>
        <Chip
          on={nowOn}
          toggle
          onClick={() =>
            set({
              visit_window: nowOn
                ? { date: null, earliest_arrival: null, latest_departure: null }
                : { ...visit, date: localDate(), earliest_arrival: nowTime() },
            })
          }
        >
          {nowOn && <span className="size-2 rounded-full bg-open" aria-hidden />}
          {nowLabel}
        </Chip>
        <Chip on={!!budget} aria-haspopup="dialog" aria-label={`بودجه: ${budget ?? "بدون سقف"}`} onClick={() => show("budget")}>
          {budget ?? "بودجه"}
          <ChevronDown className="size-4" aria-hidden />
        </Chip>
        <Chip on={payment.kind === "torob_pay"} toggle onClick={() => pay("torob_pay")}>
          ترب‌پی حضوری
        </Chip>
        <Chip on={payment.kind === "installment"} toggle onClick={() => pay("installment")}>
          اقساطی
        </Chip>
        <Chip on={must_have.warranty} toggle onClick={() => set({ must_have: { ...must_have, warranty: !must_have.warranty } })}>
          گارانتی
        </Chip>
      </div>

      <Drawer open={open} onOpenChange={setOpen} showSwipeHandle>
        <DrawerContent>
          <DrawerHeader>
            <DrawerTitle className="font-bold">{TITLES[sheet]}</DrawerTitle>
          </DrawerHeader>
          <div className="flex flex-col gap-4 overflow-y-auto p-4">
            {sheet !== "budget" && areaPanel}
            {sheet !== "area" && budgetPanel}
            {sheet === "all" && (
              <>
                <div className="flex gap-2" role="group" aria-label="زمان مراجعه">
                  <select
                    aria-label="روز مراجعه"
                    value={visit.date ?? ""}
                    onChange={(e) => set({ visit_window: { ...visit, date: e.target.value || null } })}
                    className="h-9 min-w-0 flex-1 rounded-lg border bg-card px-2 text-sm"
                  >
                    <option value="">هر روز</option>
                    <option value={localDate()}>امروز</option>
                    <option value={localDate(1)}>فردا</option>
                  </select>
                  <Input
                    type="time"
                    aria-label="ساعت رسیدن"
                    value={visit.earliest_arrival?.slice(0, 5) ?? ""}
                    onChange={(e) => set({ visit_window: { ...visit, earliest_arrival: e.target.value || null } })}
                    className="h-9 flex-1"
                  />
                </div>
                <Choices label="نحوه رفتن" options={MODES} value={brief.travel_mode} onPick={(v) => set({ travel_mode: v })} />
                <Choices label="پرداخت" options={PAYMENTS} value={payment.kind} onPick={(v) => set({ payment: { kind: v, provider: null } })} />
                {payment.kind === "installment" && (
                  <Choices
                    label="ارائه‌دهنده اقساط"
                    options={Object.fromEntries([["", "هر کدام"], ...PROVIDERS.map((p) => [p, p])])}
                    value={payment.provider ?? ""}
                    onPick={(v) => set({ payment: { kind: "installment", provider: v || null } })}
                  />
                )}
                <div className="flex flex-wrap gap-2" role="group" aria-label="شرایط لازم">
                  {(Object.keys(MUST_HAVE) as (keyof MustHave)[]).map((k) => (
                    <Chip key={k} on={must_have[k]} toggle onClick={() => set({ must_have: { ...must_have, [k]: !must_have[k] } })}>
                      {MUST_HAVE[k]}
                    </Chip>
                  ))}
                </div>
                <Choices
                  label="مرتب‌سازی"
                  options={PRIORITIES}
                  value={brief.priority}
                  onPick={(v) => (v === "closest" ? withOrigin({ priority: v }) : set({ priority: v }))}
                />
              </>
            )}
            {geoError && <p className="text-xs text-destructive">موقعیت شما در دسترس نیست. محله یا پاساژ را انتخاب کنید.</p>}
          </div>
        </DrawerContent>
      </Drawer>
    </section>
  );
}
