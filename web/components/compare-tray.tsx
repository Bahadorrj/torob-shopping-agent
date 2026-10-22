"use client";

import Link from "next/link";
import { createContext, useContext, useMemo, useState } from "react";

import { Button, buttonVariants } from "@/components/ui/button";
import { faDigits } from "@/lib/format";

const MAX = 3;

type Item = { product_id: string; title: string };

type Tray = { items: Item[]; toggle: (item: Item) => void };

const TrayContext = createContext<Tray | null>(null);

function useTray() {
  const ctx = useContext(TrayContext);
  if (!ctx) throw new Error("useTray outside CompareTrayProvider");
  return ctx;
}

// shortcut: the tray lives in memory and a reload empties it; keep it in the session if users miss it
export function CompareTrayProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<Item[]>([]);
  const value = useMemo(
    () => ({
      items,
      toggle: (item: Item) =>
        setItems((all) =>
          all.some((i) => i.product_id === item.product_id)
            ? all.filter((i) => i.product_id !== item.product_id)
            : all.length < MAX
              ? [...all, item]
              : all,
        ),
    }),
    [items],
  );
  return <TrayContext.Provider value={value}>{children}</TrayContext.Provider>;
}

// one compare pick, for products here and for sellers in the seller list; a full pick list disables adding
export function CompareToggle({ on, full, onToggle }: { on: boolean; full: boolean; onToggle: () => void }) {
  return (
    <Button variant="outline" size="sm" className="self-start" aria-pressed={on} disabled={!on && full} onClick={onToggle}>
      {on ? "حذف از مقایسه" : "افزودن به مقایسه"}
    </Button>
  );
}

export function TrayToggle({ item }: { item: Item }) {
  const { items, toggle } = useTray();
  return <CompareToggle on={items.some((i) => i.product_id === item.product_id)} full={items.length >= MAX} onToggle={() => toggle(item)} />;
}

export function CompareTrayBar() {
  const { items, toggle } = useTray();
  if (items.length === 0) return null;
  return (
    <section aria-label="سبد مقایسه" className="flex flex-col gap-2 border-t py-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-semibold">
          مقایسه: {faDigits(items.length)} از {faDigits(MAX)}
        </span>
        {items.length >= 2 ? (
          <Link href={`/compare?${new URLSearchParams({ ids: items.map((i) => i.product_id).join(",") })}`} className={buttonVariants({ size: "sm" })}>
            مقایسه
          </Link>
        ) : (
          <span className="text-xs text-muted-foreground">کالای دیگری اضافه کنید</span>
        )}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {items.map((i) => (
          <Button key={i.product_id} variant="outline" size="xs" className="max-w-40" aria-label={`حذف ${i.title} از مقایسه`} onClick={() => toggle(i)}>
            <span className="truncate">{i.title}</span> ×
          </Button>
        ))}
      </div>
    </section>
  );
}
