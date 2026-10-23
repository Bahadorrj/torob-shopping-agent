"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { useBrief } from "@/components/brief-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { optimizeBasket, type Basket, type BasketItem, type BasketStopItem } from "@/lib/api";
import { COVERAGE, faDigits, faText, locate } from "@/lib/format";

const quantity = (i: BasketItem) => (i.unit === "meter" ? `${faDigits(i.quantity)} متر` : `${faDigits(i.quantity)} عدد`);

function StopLine({ o, item }: { o: BasketStopItem; item: BasketItem }) {
  return (
    <li className="flex flex-col gap-0.5">
      <span>
        {item.title ?? item.line} <span className="text-muted-foreground">({quantity(item)})</span>
      </span>
      <span className="flex flex-wrap items-center gap-1.5 text-muted-foreground">
        {o.trust_level === "category_only" ? (
          <Badge variant="outline">فقط دسته‌بندی فروشگاه؛ موجودی را بپرسید</Badge>
        ) : o.price_toman === null ? (
          "قیمت ثبت نشده"
        ) : (
          <>
            {o.per_meter ? "قیمت هر متر" : "قیمت"} {faDigits(o.price_toman)} تومان
            {o.total_toman !== null && o.total_toman !== o.price_toman && `، جمع ${faDigits(o.total_toman)} تومان`}
          </>
        )}
      </span>
    </li>
  );
}

// the stops in the visit plan, from the brief's origin, else the device's location
function PlanThis({ shopIds }: { shopIds: string[] }) {
  const { session } = useBrief();
  const router = useRouter();
  const [geoError, setGeoError] = useState(false);
  const go = async () => {
    const b = session?.brief;
    let origin = b?.origin;
    if (!origin) {
      try {
        origin = await locate();
      } catch {
        setGeoError(true);
        return;
      }
    }
    const q = new URLSearchParams(shopIds.map((id) => ["shop_id", id]));
    q.set("lat", String(origin.lat));
    q.set("lon", String(origin.lon));
    q.set("mode", b?.travel_mode ?? "walk");
    if (session) q.set("session_id", session.session_id);
    router.push(`/plan?${q}`);
  };
  return (
    <div className="flex flex-col gap-1">
      <Button className="self-start" onClick={go}>
        برنامه مراجعه
      </Button>
      {geoError && <p className="text-xs text-destructive">موقعیت شما در دسترس نیست؛ برای برنامه مراجعه آن را روشن کنید.</p>}
    </div>
  );
}

export function BasketView({ basket }: { basket: Basket }) {
  const { items, stops, missing } = basket;
  return (
    <div className="flex flex-col gap-3 text-sm">
      <p>
        {stops.length ? `${faDigits(stops.length)} توقف` : "هیچ فروشگاهی این فهرست را پوشش نمی‌دهد."}
        {basket.total_toman > 0 && `، جمع قیمت‌دار ${faDigits(basket.total_toman)} تومان`}
      </p>
      <ol className="flex flex-col gap-2">
        {stops.map((s, n) => (
          <li key={s.shop_id}>
            <Card className="gap-2 p-3">
              <h3 className="font-semibold">
                {faDigits(n + 1)}. {s.shop_name}
              </h3>
              {s.address && <p className="text-xs text-muted-foreground">{faText(s.address)}</p>}
              <ul className="flex flex-col gap-1.5">
                {s.items.map((o) => (
                  <StopLine key={o.item} o={o} item={items[o.item]} />
                ))}
              </ul>
            </Card>
          </li>
        ))}
      </ol>
      {missing.length > 0 && (
        <section aria-labelledby="missing" className="flex flex-col gap-1">
          <h3 id="missing" className="font-semibold">
            پیدا نشد
          </h3>
          <ul className="list-inside list-disc text-muted-foreground">
            {missing.map((i) => (
              <li key={i}>{items[i].line}</li>
            ))}
          </ul>
        </section>
      )}
      {(stops.length === 0 || missing.length > 0) && <p className="text-muted-foreground">{COVERAGE}</p>}
      {stops.length > 0 && <PlanThis shopIds={stops.map((s) => s.shop_id)} />}
    </div>
  );
}

type State = { status: "loading" } | { status: "error" } | { status: "done"; basket: Basket };

export function BasketPlan({ text }: { text: string }) {
  const { session } = useBrief();
  const [state, setState] = useState<State>({ status: "loading" });
  const brief = session?.brief;
  useEffect(() => {
    if (!brief) return;
    optimizeBasket(text, brief).then(
      (basket) => setState({ status: "done", basket }),
      () => setState({ status: "error" }),
    );
  }, [text, brief]);
  if (state.status === "error") return <p className="text-sm text-destructive">برنامه خرید ساخته نشد. دوباره تلاش کنید.</p>;
  if (state.status === "loading") return <p className="text-sm text-muted-foreground">در حال بارگذاری...</p>;
  return <BasketView basket={state.basket} />;
}
