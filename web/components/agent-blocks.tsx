"use client";

import Link from "next/link";
import type { ReactNode } from "react";

import { ProductCard } from "@/components/product-card";
import { Seller } from "@/components/seller-list";
import { Button } from "@/components/ui/button";
import type { ProductCard as Product, ProductCompare, SellerCompare, SellerList } from "@/lib/api";

// One renderer per block type. A block is an agent tool result: `{ block: "<type>", ...tool output }`
// (backend/src/pasazhgard/agent.py). Numbers on screen come from these fields only, never from agent text.
type Chips = { field: string; question: string; options: string[] };

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
