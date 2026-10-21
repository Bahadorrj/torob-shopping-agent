"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { findSellers, type Priority, type Reason, type SellerList as List, type SellerQuery, type SellerRow } from "@/lib/api";
import { distance, faDigits, faText, priceAge } from "@/lib/format";

const PRIORITIES: { value: Priority; label: string }[] = [
  { value: "cheapest", label: "ارزان‌ترین" },
  { value: "closest", label: "نزدیک‌ترین" },
  { value: "most_reliable", label: "معتبرترین" },
];

const RADII = [500, 1000, 2000, 5000];

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

type Origin = { lat: number; lon: number };
type Result = { key: string; list: List | null } | { key: string; error: true };

export function SellerList({ productId }: { productId: string }) {
  // "all", "near:<m>", "area:<name>" or "pasaj:<name>"
  const [where, setWhere] = useState("all");
  const [priority, setPriority] = useState<Priority>("cheapest");
  const [origin, setOrigin] = useState<Origin | null>(null);
  const [geoError, setGeoError] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [areas, setAreas] = useState<{ areas: string[]; pasajs: string[] }>({ areas: [], pasajs: [] });

  const kind = where.split(":")[0];
  const value = where.slice(kind.length + 1);
  const query: SellerQuery = { priority, ...(origin && { lat: origin.lat, lon: origin.lon }) };
  if (kind === "near" && origin) query.radius_m = Number(value);
  if (kind === "area") query.area = value;
  if (kind === "pasaj") query.pasaj = value;
  // a radius waits for the location
  const ready = kind !== "near" || origin !== null;
  const key = JSON.stringify(query);

  useEffect(() => {
    if (!ready) return;
    findSellers(productId, JSON.parse(key)).then(
      (list) => {
        setResult({ key, list });
        if (list) setAreas({ areas: list.areas, pasajs: list.pasajs });
      },
      () => setResult({ key, error: true }),
    );
  }, [productId, key, ready]);

  function locate() {
    if (origin) return;
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setGeoError(false);
        setOrigin({ lat: p.coords.latitude, lon: p.coords.longitude });
      },
      () => setGeoError(true),
    );
  }

  if (result === null) return <p className="text-sm text-muted-foreground">در حال بارگذاری...</p>;
  if ("error" in result) return <p className="text-sm text-destructive">فهرست فروشنده‌ها دریافت نشد. دوباره تلاش کنید.</p>;
  if (result.list === null) return <p className="text-sm text-muted-foreground">کالا پیدا نشد.</p>;

  const list = result.list;
  const loading = result.key !== key || !ready;
  const nearest = list.nearest_covered;

  return (
    <article className="flex flex-col gap-4">
      <h1 className="text-lg font-bold leading-7">{list.title}</h1>

      <div className="flex flex-col gap-2">
        <label className="flex items-center gap-2 text-sm">
          <span className="shrink-0 text-muted-foreground">محدوده</span>
          <select
            value={where}
            onChange={(e) => {
              setWhere(e.target.value);
              if (e.target.value.startsWith("near:")) locate();
            }}
            className="h-9 min-w-0 flex-1 rounded-lg border bg-background px-2"
          >
            <option value="all">همه مناطق پوشش‌داده‌شده</option>
            <optgroup label="نزدیک من">
              {RADII.map((r) => (
                <option key={r} value={`near:${r}`}>
                  نزدیک من، {distance(r)}
                </option>
              ))}
            </optgroup>
            <optgroup label="محله">
              {areas.areas.map((a) => (
                <option key={a} value={`area:${a}`}>
                  {a}
                </option>
              ))}
            </optgroup>
            <optgroup label="پاساژ">
              {areas.pasajs.map((p) => (
                <option key={p} value={`pasaj:${p}`}>
                  پاساژ {faText(p)}
                </option>
              ))}
            </optgroup>
          </select>
        </label>
        {geoError && <p className="text-xs text-destructive">موقعیت شما در دسترس نیست. محله یا پاساژ را انتخاب کنید.</p>}
        <div className="flex flex-wrap gap-2" role="group" aria-label="مرتب‌سازی">
          {PRIORITIES.map((p) => (
            <Button
              key={p.value}
              size="sm"
              variant={priority === p.value ? "default" : "outline"}
              aria-pressed={priority === p.value}
              onClick={() => {
                setPriority(p.value);
                if (p.value === "closest") locate();
              }}
            >
              {p.label}
            </Button>
          ))}
        </div>
      </div>

      <p className="text-sm" aria-live="polite">
        {loading ? "در حال به‌روزرسانی..." : `${faDigits(list.count)} فروشنده`}
      </p>

      {list.count === 0 ? (
        <div className="flex flex-col gap-2 rounded-lg border p-3 text-sm">
          <p>این محدوده پوشش داده نشده و فروشنده‌ای برای این کالا ندارد.</p>
          <p className="text-muted-foreground">{COVERAGE}</p>
          {nearest && (nearest.area || nearest.pasaj) && (
            <Button
              variant="outline"
              className="h-auto self-start whitespace-normal py-1.5 text-start"
              onClick={() => setWhere(nearest.area ? `area:${nearest.area}` : `pasaj:${nearest.pasaj}`)}
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
