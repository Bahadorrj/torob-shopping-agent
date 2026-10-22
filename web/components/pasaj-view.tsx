"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { useBrief } from "@/components/brief-provider";
import { getPasaj, type PasajView as View } from "@/lib/api";
import { faDigits, faText } from "@/lib/format";

type State = { status: "loading" } | { status: "error" } | { status: "missing" } | { status: "done"; view: View };

export const pasajHref = (pasaj: string, productId?: string) =>
  `/pasajs/${encodeURIComponent(pasaj)}${productId ? `?${new URLSearchParams({ product: productId })}` : ""}`;

export function PasajView({ pasaj, productIds }: { pasaj: string; productIds: string[] }) {
  const { session } = useBrief();
  const sid = session?.session_id;
  const [state, setState] = useState<State>({ status: "loading" });
  const products = productIds.join(",");

  // the session's brief picks the products beside the ones in the link
  useEffect(() => {
    if (!sid) return;
    getPasaj(pasaj, products ? products.split(",") : [], sid).then(
      (view) => setState(view ? { status: "done", view } : { status: "missing" }),
      () => setState({ status: "error" }),
    );
  }, [pasaj, products, sid]);

  if (state.status === "loading") return <p className="text-sm text-muted-foreground">در حال بارگذاری...</p>;
  if (state.status === "error") return <p className="text-sm text-destructive">اطلاعات پاساژ دریافت نشد. دوباره تلاش کنید.</p>;
  if (state.status === "missing") return <p className="text-sm text-muted-foreground">پاساژ پیدا نشد.</p>;

  const { view } = state;
  return (
    <article className="flex flex-col gap-4">
      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-bold">{faText(`پاساژ ${view.pasaj}`)}</h1>
        <p className="text-sm">{faDigits(view.count)} فروشگاه</p>
      </header>
      {view.count === 0 && <p className="rounded-lg border p-3 text-sm">در این پاساژ فروشگاهی کالاهای شما را ثبت نکرده است.</p>}
      {view.floors.map((f, i) => {
        const title = f.floor === null ? "طبقه ثبت نشده" : faText(`طبقه ${f.floor}`);
        const id = `floor-${i}`;
        return (
          <section key={id} aria-labelledby={id} className="flex flex-col gap-2">
            <h2 id={id} className="text-sm font-semibold">
              {title}
            </h2>
            <ul className="flex flex-col gap-2">
              {f.shops.map((s) => (
                <li key={s.shop_id} className="flex flex-col gap-1 rounded-lg border p-3 text-sm">
                  <div className="flex items-start justify-between gap-2">
                    <Link href={`/shops/${s.shop_id}`} className="font-semibold text-primary underline underline-offset-4">
                      {s.shop_name}
                    </Link>
                    <span className="shrink-0 text-xs text-muted-foreground">{s.unit ? faText(`واحد ${s.unit}`) : "واحد ثبت نشده"}</span>
                  </div>
                  {s.products.map((p) => (
                    <p key={p.product_id} className="flex justify-between gap-2 text-xs">
                      <span className="min-w-0">{p.title}</span>
                      {p.price_toman !== null ? (
                        <span className="shrink-0 font-bold">{faDigits(p.price_toman)} تومان</span>
                      ) : (
                        <span className="shrink-0 text-muted-foreground">قیمت ثبت نشده</span>
                      )}
                    </p>
                  ))}
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </article>
  );
}
