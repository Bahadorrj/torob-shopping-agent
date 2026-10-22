"use client";

import { useState } from "react";

import { useBrief } from "@/components/brief-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Brief, Center, MustHave, PaymentKind, Priority, SessionPatch, TravelMode } from "@/lib/api";
import { distance, faDigits, faText, localDate, locate } from "@/lib/format";

const RADII = [500, 1000, 2000, 5000];

const PRIORITIES: Record<Priority, string> = { cheapest: "ارزان‌ترین", closest: "نزدیک‌ترین", most_reliable: "معتبرترین" };
const MODES: Record<TravelMode, string> = { walk: "پیاده", transit: "مترو و اتوبوس", car: "خودرو" };
const PAYMENTS: Record<PaymentKind, string> = { any: "هر روشی", cash: "نقدی", torob_pay: "ترب‌پی حضوری", installment: "اقساطی" };

const PROVIDERS = ["ترب‌پی", "اسنپ‌پی", "دیجی‌پی", "تارا", "ازکی‌وام"];
const MUST_HAVE: Record<keyof MustHave, string> = { warranty: "گارانتی", test_in_presence: "تست در حضور مشتری", fast_delivery: "ارسال سریع" };

type Field = "area" | "budget" | "visit" | "travel" | "payment" | "must_have" | "priority";

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

// "all", "near:<m>", "area:<name>" or "pasaj:<name>"
function areaValue(area: Brief["area"]) {
  if (!area) return "all";
  if (area.radius_m !== null) return `near:${area.radius_m}`;
  return area.name !== null ? `area:${area.name}` : `pasaj:${area.pasaj}`;
}

function Choices<T extends string>({ label, options, value, onPick }: { label: string; options: Record<T, string>; value: T | null; onPick: (v: T) => void }) {
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

export function BriefBar() {
  const { session, patch } = useBrief();
  const [open, setOpen] = useState<Field | null>(null);
  const [geoError, setGeoError] = useState(false);
  if (!session) return null;
  const { brief } = session;
  const set = (b: SessionPatch["brief"]) => patch({ brief: b });
  const { origin } = brief;
  const { centers } = session;
  const center = origin ? centers.find((c) => c.lat === origin.lat && c.lon === origin.lon) : undefined;

  async function pickOrigin(v: string) {
    const picked = centers.find((c) => `${c.kind}:${c.name}` === v);
    if (picked) return set({ origin: { lat: picked.lat, lon: picked.lon } });
    try {
      const here = await locate();
      setGeoError(false);
      set({ origin: here });
    } catch {
      setGeoError(true);
    }
  }

  // geolocation first when a choice needs the origin; the origin is kept for later radius and distance use
  async function withOrigin(b: NonNullable<SessionPatch["brief"]>) {
    if (brief.origin) return set(b);
    try {
      const origin = await locate();
      setGeoError(false);
      return set({ ...b, origin });
    } catch {
      setGeoError(true);
      // a ranking still works without the origin, a radius does not
      if (!("area" in b)) return set(b);
    }
  }

  function pickArea(v: string) {
    const kind = v.split(":")[0];
    const value = v.slice(kind.length + 1);
    if (kind === "near") return withOrigin({ area: { radius_m: Number(value) } });
    set({ area: kind === "area" ? { name: value } : kind === "pasaj" ? { pasaj: value } : null });
  }

  const chips: { field: Field; label: string; value: string }[] = [
    { field: "area", label: "محدوده", value: areaLabel(brief.area, center) },
    {
      field: "budget",
      label: "بودجه",
      value: brief.budget.max_total_toman ? `تا ${faDigits(brief.budget.max_total_toman)} تومان` : "بدون سقف",
    },
    { field: "visit", label: "زمان مراجعه", value: visitLabel(brief.visit_window) },
    { field: "travel", label: "نحوه رفتن", value: brief.travel_mode ? MODES[brief.travel_mode] : "انتخاب نشده" },
    { field: "payment", label: "پرداخت", value: [PAYMENTS[brief.payment.kind], brief.payment.provider].filter(Boolean).join(" ") },
    {
      field: "must_have",
      label: "شرایط",
      value: (Object.keys(MUST_HAVE) as (keyof MustHave)[]).filter((k) => brief.must_have[k]).map((k) => MUST_HAVE[k]).join("، ") || "هیچ",
    },
    { field: "priority", label: "اولویت", value: PRIORITIES[brief.priority] },
  ];

  return (
    <section aria-label="خلاصه خرید" className="sticky top-0 z-10 border-b bg-background">
      <div className="mx-auto flex w-full max-w-xl flex-col gap-2 px-4 py-2">
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
          {chips.map((c) => (
            <Button
              key={c.field}
              size="sm"
              variant={open === c.field ? "secondary" : "outline"}
              aria-expanded={open === c.field}
              onClick={() => setOpen(open === c.field ? null : c.field)}
            >
              {c.label}: {c.value}
            </Button>
          ))}
        </div>

        {open === "area" && (
          <select
            aria-label="مرکز شعاع"
            value={center ? `${center.kind}:${center.name}` : origin ? "me" : ""}
            onChange={(e) => pickOrigin(e.target.value)}
            className="h-9 min-w-0 rounded-lg border bg-background px-2 text-sm"
          >
            {!origin && <option value="">مرکز شعاع: انتخاب نشده</option>}
            <option value="me">مرکز شعاع: موقعیت من</option>
            {centers.map((c) => (
              <option key={`${c.kind}:${c.name}`} value={`${c.kind}:${c.name}`}>
                مرکز شعاع: {placeLabel(c.kind, c.name)}
              </option>
            ))}
          </select>
        )}
        {open === "area" && (
          <select
            aria-label="انتخاب محدوده"
            value={areaValue(brief.area)}
            onChange={(e) => pickArea(e.target.value)}
            className="h-9 min-w-0 rounded-lg border bg-background px-2 text-sm"
          >
            <option value="all">همه مناطق پوشش‌داده‌شده</option>
            <optgroup label={center ? "شعاع" : "نزدیک من"}>
              {RADII.map((r) => (
                <option key={r} value={`near:${r}`}>
                  {radiusLabel(r, center)}
                </option>
              ))}
            </optgroup>
            <optgroup label="محله">
              {session.areas.map((a) => (
                <option key={a} value={`area:${a}`}>
                  {a}
                </option>
              ))}
            </optgroup>
            <optgroup label="پاساژ">
              {session.pasajs.map((p) => (
                <option key={p} value={`pasaj:${p}`}>
                  پاساژ {faText(p)}
                </option>
              ))}
            </optgroup>
          </select>
        )}
        {open === "budget" && (
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              const n = Number(new FormData(e.currentTarget).get("budget"));
              set({ budget: { ...brief.budget, max_total_toman: n > 0 ? n : null } });
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
        )}
        {open === "visit" && (
          <div className="flex gap-2">
            <select
              aria-label="روز مراجعه"
              value={brief.visit_window.date ?? ""}
              onChange={(e) => set({ visit_window: { ...brief.visit_window, date: e.target.value || null } })}
              className="h-9 min-w-0 flex-1 rounded-lg border bg-background px-2 text-sm"
            >
              <option value="">هر روز</option>
              <option value={localDate()}>امروز</option>
              <option value={localDate(1)}>فردا</option>
            </select>
            <Input
              type="time"
              aria-label="ساعت رسیدن"
              value={brief.visit_window.earliest_arrival?.slice(0, 5) ?? ""}
              onChange={(e) => set({ visit_window: { ...brief.visit_window, earliest_arrival: e.target.value || null } })}
              className="h-9 flex-1"
            />
          </div>
        )}
        {open === "travel" && <Choices label="نحوه رفتن" options={MODES} value={brief.travel_mode} onPick={(v) => set({ travel_mode: v })} />}
        {open === "payment" && (
          <Choices label="پرداخت" options={PAYMENTS} value={brief.payment.kind} onPick={(v) => set({ payment: { kind: v, provider: null } })} />
        )}
        {open === "payment" && brief.payment.kind === "installment" && (
          <Choices
            label="ارائه‌دهنده اقساط"
            options={Object.fromEntries([["", "هر کدام"], ...PROVIDERS.map((p) => [p, p])])}
            value={brief.payment.provider ?? ""}
            onPick={(v) => set({ payment: { kind: "installment", provider: v || null } })}
          />
        )}
        {open === "must_have" && (
          <div className="flex flex-wrap gap-2" role="group" aria-label="شرایط لازم">
            {(Object.keys(MUST_HAVE) as (keyof MustHave)[]).map((k) => (
              <Button
                key={k}
                size="sm"
                variant={brief.must_have[k] ? "default" : "outline"}
                aria-pressed={brief.must_have[k]}
                onClick={() => set({ must_have: { ...brief.must_have, [k]: !brief.must_have[k] } })}
              >
                {MUST_HAVE[k]}
              </Button>
            ))}
          </div>
        )}
        {open === "priority" && (
          <Choices
            label="مرتب‌سازی"
            options={PRIORITIES}
            value={brief.priority}
            onPick={(v) => (v === "closest" ? withOrigin({ priority: v }) : set({ priority: v }))}
          />
        )}
        {geoError && <p className="text-xs text-destructive">موقعیت شما در دسترس نیست. محله یا پاساژ را انتخاب کنید.</p>}
      </div>
    </section>
  );
}
