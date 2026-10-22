"use client";

import Link from "next/link";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import type { Alternative, Alternatives as Block } from "@/lib/api";

const REASON: Record<Block["reason"], string> = {
  unavailable: "موجود نبود. به جایش:",
  no_reply: "پاسخ نداد. به جایش:",
  closed: "الان بسته است. به جایش:",
};

// The alternatives block: the top 2 places to ask instead, each with its trade-off and a one-tap inquiry.
export function Alternatives({ block, onAsk }: { block: Block; onAsk: (a: Alternative) => Promise<unknown> }) {
  const [asked, setAsked] = useState<string[]>([]);
  const [error, setError] = useState(false);

  async function ask(a: Alternative) {
    try {
      await onAsk(a);
      setAsked((s) => [...s, a.shop_id]);
      setError(false);
    } catch {
      setError(true);
    }
  }

  if (block.alternatives.length === 0) return <p className="text-xs text-muted-foreground">جایگزینی پیدا نشد.</p>;
  return (
    <section className="flex flex-col gap-2 rounded-md bg-muted p-2" aria-label="جایگزین‌ها">
      <h3 className="text-xs font-semibold">{REASON[block.reason]}</h3>
      <ul className="flex flex-col gap-2">
        {block.alternatives.map((a) => (
          <li key={`${a.shop_id}-${a.product_id}`} className="flex flex-col gap-1">
            <Link href={`/shops/${a.shop_id}`} className="font-semibold text-primary underline-offset-4 hover:underline">
              {a.shop_name}
            </Link>
            {a.kind === "similar_product" && <span className="text-xs">{a.product_title}</span>}
            <span className="text-xs text-muted-foreground">{a.tradeoff}</span>
            <Button
              size="xs"
              variant="outline"
              className="h-auto self-start py-1 whitespace-normal"
              disabled={asked.includes(a.shop_id)}
              onClick={() => ask(a)}
            >
              {asked.includes(a.shop_id) ? "پرسیده شد" : "از این فروشنده بپرس"}
            </Button>
          </li>
        ))}
      </ul>
      {error && <p className="text-xs text-destructive">ارسال نشد. برای هر کالا حداکثر ۳ استعلام باز می‌ماند.</p>}
    </section>
  );
}
