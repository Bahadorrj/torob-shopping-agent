"use client";

import Link from "next/link";
import type { ReactNode } from "react";

import { useBrief } from "@/components/brief-provider";
import { InquiryTracker } from "@/components/inquiry-tracker";
import { ProductCard } from "@/components/product-card";
import { Seller } from "@/components/seller-list";
import { Button } from "@/components/ui/button";
import { clock, OpenBadge, RouteDetails } from "@/components/visit-plan";
import {
  confirmInquiries,
  inquiriesStreamUrl,
  type Directions,
  type Inquiry,
  type InquiryStatus,
  type ProductCard as Product,
  type ProductCompare,
  type SellerCompare,
  type SellerList,
  type VisitPlan,
} from "@/lib/api";
import { faDigits } from "@/lib/format";
import { useEventStream } from "@/lib/use-event-stream";

// One renderer per block type. A block is an agent tool result: `{ block: "<type>", ...tool output }`
// (backend/src/pasazhgard/agent.py). Numbers on screen come from these fields only, never from agent text.
type Chips = { field: string; question: string; options: string[] };

// The block's inquiries as they are now, not as the tool saw them. The tap sends through the REST confirm path:
// consent never goes through the model (ADR-0002 fallback).
function Inquiries({ initial }: { initial: Inquiry[] }) {
  // the sheet renders only once the session exists
  const sid = useBrief().session!.session_id;
  // shortcut: one stream per block; share one per session if threads grow many inquiry blocks
  const live = useEventStream<InquiryStatus>(inquiriesStreamUrl(sid));
  const ids = new Set(initial.map((i) => i.inquiry_id));
  const inquiries = live ? live.inquiries.filter((i) => ids.has(i.inquiry_id)) : initial;
  return <InquiryTracker inquiries={inquiries} onConfirm={(inquiryIds) => confirmInquiries(sid, inquiryIds)} />;
}

// the plan screen's query asks the backend for the same plan, so it is also the share link
const planHref = (p: VisitPlan) =>
  `/plan?${new URLSearchParams([
    ...p.stops.map((s) => ["shop_id", s.shop_id]),
    ["lat", String(p.origin.lat)],
    ["lon", String(p.origin.lon)],
    ["mode", p.mode],
    ["depart_at", p.depart_at],
  ])}`;

const linkClass = "text-sm font-medium text-primary underline-offset-4 hover:underline";

export const BLOCKS: Record<string, (data: never, send: (text: string) => void) => ReactNode> = {
  product_cards: (d: { items: Product[] }) =>
    d.items.length ? (
      <ul className="flex flex-col gap-2">
        {d.items.slice(0, 5).map((p) => (
          <li key={p.product_id}>
            <ProductCard product={p} />
          </li>
        ))}
      </ul>
    ) : (
      <p className="text-sm text-muted-foreground">کالایی پیدا نشد.</p>
    ),
  seller_list: (d: SellerList) => (
    <div className="flex flex-col gap-2">
      {d.sellers.slice(0, 3).map((s) => (
        <Seller key={s.offer_id} s={s} />
      ))}
      <Link href={`/products/${d.product_id}/sellers`} className={linkClass}>
        همه فروشنده‌های {d.title}
      </Link>
    </div>
  ),
  compare_table: (d: ProductCompare) => (
    <div className="flex flex-col gap-1 text-sm">
      <p>{d.products.map((p) => p.title).join(" / ")}</p>
      <Link href={`/compare?${new URLSearchParams({ ids: d.products.map((p) => p.product_id).join(",") })}`} className={linkClass}>
        دیدن جدول مقایسه
      </Link>
    </div>
  ),
  seller_compare: (d: SellerCompare) => (
    <div className="flex flex-col gap-1 text-sm">
      <p>{d.sellers.map((s) => s.shop_name).join(" / ")}</p>
      <Link
        href={`/products/${d.product_id}/sellers/compare?${new URLSearchParams(d.sellers.map((s) => ["offer", s.offer_id]))}`}
        className={linkClass}
      >
        مقایسه فروشنده‌ها
      </Link>
    </div>
  ),
  inquiry_status: (d: InquiryStatus) => <Inquiries initial={d.inquiries} />,
  visit_plan: (d: VisitPlan) => (
    <div className="flex flex-col gap-1.5 text-sm">
      <ol className="flex flex-col gap-1">
        {d.stops.map((s, i) => (
          <li key={s.shop_id} className="flex flex-wrap items-center gap-1.5">
            <span>
              {faDigits(i + 1)}. {s.shop_name}، رسیدن {clock(s.eta)}
            </span>
            <OpenBadge open={s.open_at_eta} />
          </li>
        ))}
      </ol>
      <Link href={planHref(d)} className={linkClass}>
        دیدن برنامه روی نقشه
      </Link>
    </div>
  ),
  directions: (d: Directions) => (
    <div className="flex flex-col gap-1.5 text-sm">
      <p className="font-semibold">{d.shop_name}</p>
      <RouteDetails d={d} />
    </div>
  ),
  chips: (d: Chips, send) => (
    <div className="flex flex-col gap-2">
      <p className="text-sm">{d.question}</p>
      <div className="flex flex-wrap gap-1.5">
        {d.options.map((o) => (
          <Button key={o} variant="outline" size="sm" onClick={() => send(o)}>
            {o}
          </Button>
        ))}
      </div>
    </div>
  ),
};

export function Block({ content, send }: { content: string; send: (text: string) => void }) {
  let data: { block?: string };
  try {
    data = JSON.parse(content);
  } catch {
    return null;
  }
  // a result without a known block (an error for the model, a newer block type) shows nothing
  const render = data.block ? BLOCKS[data.block] : undefined;
  return render ? render(data as never, send) : null;
}
