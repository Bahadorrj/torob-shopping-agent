"use client";

import Link from "next/link";
import type { ReactNode } from "react";

import { AgentAlternatives } from "@/components/alternatives";
import { ListedPrice, ProductCard } from "@/components/product-card";
import { Seller } from "@/components/seller-list";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { clock, OpenBadge, RouteDetails } from "@/components/visit-plan";
import type {
  Alternatives,
  Directions,
  ModelPick,
  ProductCard as Product,
  ProductCompare,
  SellerCompare,
  SellerList,
  Shortlist,
  VisitPlan,
} from "@/lib/api";
import { faDigits, faText } from "@/lib/format";

// One renderer per block type. A block is an agent tool result: `{ block: "<type>", ...tool output }`
// (backend/src/pasazhgard/agent.py). Numbers on screen come from these fields only, never from agent text.
type Chips = { field: string; question: string; options: string[] };

// the plan screen's query asks the backend for the same plan, so it is also the share link
const planHref = (p: VisitPlan) =>
  `/plan?${new URLSearchParams([
    ...p.stops.map((s) => ["shop_id", s.shop_id]),
    ["lat", String(p.origin.lat)],
    ["lon", String(p.origin.lon)],
    ["mode", p.mode],
    ["depart_at", p.depart_at],
  ])}`;

const linkClass ="text-sm font-medium text-primary underline-offset-4 hover:underline";

const compareHref = (ids: string[]) => `/compare?${new URLSearchParams({ ids: ids.join(",") })}`;

function Pick({ m }: { m: ModelPick }) {
  return (
    <Card className="gap-1.5 p-3">
      <h3 className="line-clamp-2 text-sm font-semibold leading-6">{m.title}</h3>
      {m.key_specs.length > 0 && (
        <p className="line-clamp-1 text-xs text-muted-foreground">{m.key_specs.map((s) => `${s.key}: ${s.value}`).join(" · ")}</p>
      )}
      <ListedPrice price={m.price} />
      <p className="text-xs text-muted-foreground">{faDigits(m.seller_count)} فروشنده در این محدوده</p>
      {m.tradeoffs.length > 0 && (
        <ul className="list-disc ps-4 text-xs leading-5">
          {m.tradeoffs.map((t) => (
            <li key={t} className="break-words">
              {faText(t)}
            </li>
          ))}
        </ul>
      )}
      <Link href={`/products/${m.product_id}/sellers`} className={linkClass}>
        دیدن فروشنده‌ها
      </Link>
    </Card>
  );
}

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
  model_shortlist: (d: Shortlist) => (
    <div className="flex flex-col gap-2">
      <ul className="flex flex-col gap-2">
        {d.models.map((m) => (
          <li key={m.product_id}>
            <Pick m={m} />
          </li>
        ))}
      </ul>
      {d.models.length > 1 && (
        <Link href={compareHref(d.models.map((m) => m.product_id))} className={linkClass}>
          مقایسه این مدل‌ها
        </Link>
      )}
    </div>
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
      <Link href={compareHref(d.products.map((p) => p.product_id))} className={linkClass}>
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
  alternatives: (d: Alternatives) => <AgentAlternatives block={d} />,
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
