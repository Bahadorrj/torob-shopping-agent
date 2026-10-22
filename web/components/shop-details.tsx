"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { pasajHref } from "@/components/pasaj-view";
import { Badge } from "@/components/ui/badge";
import { getShop, type Day, type DayHours, type ShopDetails as Shop } from "@/lib/api";
import { faText } from "@/lib/format";

const DAY_NAMES: Record<Day, string> = {
  sat: "شنبه",
  sun: "یکشنبه",
  mon: "دوشنبه",
  tue: "سه‌شنبه",
  wed: "چهارشنبه",
  thu: "پنجشنبه",
  fri: "جمعه",
};

export const DELIVERY = { yes: "دارد", no: "ندارد", unknown: null };

export function NotRecorded({ text = "ثبت نشده" }: { text?: string }) {
  return <span className="text-muted-foreground">{text}</span>;
}

function hoursText(d: DayHours) {
  if (d.status === "closed") return "تعطیل";
  if (d.status === "declared" && d.shifts.length > 0) return d.shifts.map((s) => faText(`${s.start} تا ${s.end}`)).join("، ");
  // unknown, unsupported, or declared without a usable shift
  return <NotRecorded />;
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <tr className="border-b last:border-0">
      <th scope="row" className="w-28 py-2 text-start align-top font-normal text-muted-foreground">
        {label}
      </th>
      <td className="py-2">{children ?? <NotRecorded />}</td>
    </tr>
  );
}

type State = { status: "loading" } | { status: "error" } | { status: "missing" } | { status: "done"; shop: Shop };

export function ShopDetails({ shopId }: { shopId: string }) {
  const [state, setState] = useState<State>({ status: "loading" });

  useEffect(() => {
    getShop(shopId).then(
      (shop) => setState(shop ? { status: "done", shop } : { status: "missing" }),
      () => setState({ status: "error" }),
    );
  }, [shopId]);

  if (state.status === "loading") return <p className="text-sm text-muted-foreground">در حال بارگذاری...</p>;
  if (state.status === "error") return <p className="text-sm text-destructive">اطلاعات فروشگاه دریافت نشد. دوباره تلاش کنید.</p>;
  if (state.status === "missing") return <p className="text-sm text-muted-foreground">فروشگاه پیدا نشد.</p>;

  const { shop } = state;
  const today = shop.hours.week.find((d) => d.day === shop.hours.today)!;
  return (
    <article className="flex flex-col gap-4">
      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-bold">{shop.name}</h1>
        <p className="text-sm text-muted-foreground">{shop.address ?? "نشانی ثبت نشده"}</p>
      </header>

      <section className="flex flex-col gap-1">
        <h2 className="text-sm font-semibold">مکان</h2>
        <table className="w-full text-sm">
          <tbody>
            <Row label="پاساژ">
              {shop.pasaj && (
                <span className="flex flex-wrap gap-x-3">
                  {faText(shop.pasaj)}
                  <Link href={pasajHref(shop.pasaj)} className="text-primary underline underline-offset-4">
                    همه فروشگاه‌های این پاساژ
                  </Link>
                </span>
              )}
            </Row>
            <Row label="طبقه">{shop.floor && faText(shop.floor)}</Row>
            <Row label="واحد">{shop.unit && faText(shop.unit)}</Row>
            {shop.landmark && <Row label="نشانه">{shop.landmark}</Row>}
          </tbody>
        </table>
      </section>

      <section className="flex flex-col gap-1">
        <h2 className="text-sm font-semibold">ساعت کاری (به وقت تهران)</h2>
        <table className="w-full text-sm">
          <tbody>
            <Row label="امروز">{hoursText(today)}</Row>
          </tbody>
        </table>
        <table className="w-full text-sm">
          <caption className="py-1 text-start text-xs text-muted-foreground">این هفته</caption>
          <tbody>
            {shop.hours.week.map((d) => (
              <Row key={d.day} label={DAY_NAMES[d.day]}>
                {hoursText(d)}
              </Row>
            ))}
          </tbody>
        </table>
      </section>

      <section className="flex flex-col gap-1">
        <h2 className="text-sm font-semibold">پرداخت و ارسال</h2>
        <table className="w-full text-sm">
          <tbody>
            <Row label="پرداخت">
              {shop.payment_options.length > 0 ? (
                <ul className="flex flex-col gap-1">
                  {shop.payment_options.map((p) => (
                    <li key={p.provider} className="flex flex-wrap items-center gap-1.5">
                      <span>{p.provider}</span>
                      {p.channel === "in_person" ? (
                        <Badge variant="secondary">پرداخت حضوری</Badge>
                      ) : (
                        <Badge variant="outline" className="text-muted-foreground">
                          نحوه پرداخت ثبت نشده
                        </Badge>
                      )}
                    </li>
                  ))}
                </ul>
              ) : null}
            </Row>
            <Row label="ارسال سریع">{DELIVERY[shop.fast_delivery]}</Row>
          </tbody>
        </table>
      </section>

      {(shop.website_url || shop.instagram_url) && (
        <nav className="flex flex-wrap gap-3 text-sm">
          {shop.website_url && (
            <a href={shop.website_url} target="_blank" rel="noopener noreferrer" className="text-primary underline">
              وب‌سایت
            </a>
          )}
          {shop.instagram_url && (
            <a href={shop.instagram_url} target="_blank" rel="noopener noreferrer" className="text-primary underline">
              اینستاگرام
            </a>
          )}
        </nav>
      )}
    </article>
  );
}
