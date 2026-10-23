"use client";

import { GitCompareArrows } from "lucide-react";
import Link from "next/link";
import { createContext, useContext, useMemo, useState } from "react";

import { compareKey, useBrief } from "@/components/brief-provider";
import { Button, buttonVariants } from "@/components/ui/button";
import { faDigits } from "@/lib/format";
import { cn } from "@/lib/utils";

const MAX = 3;

type Item = { product_id: string; title: string };

type Tray = { items: Item[]; toggle: (item: Item) => void };

const TrayContext = createContext<Tray | null>(null);

function useTray() {
  const ctx = useContext(TrayContext);
  if (!ctx) throw new Error("useTray outside CompareTrayProvider");
  return ctx;
}

function stored(sid: string): Item[] {
  try {
    return JSON.parse(localStorage.getItem(compareKey(sid)) ?? "[]");
  } catch {
    return [];
  }
}

// each chat (session) has its own picks, kept in localStorage so a reload or a resumed chat brings them back
export function CompareTrayProvider({ children }: { children: React.ReactNode }) {
  const sid = useBrief().session?.session_id ?? null;
  const [picks, setPicks] = useState<Record<string, Item[]>>({});
  const items = useMemo(() => (sid ? (picks[sid] ?? stored(sid)) : []), [picks, sid]);
  const value = useMemo(
    () => ({
      items,
      toggle: (item: Item) => {
        if (!sid) return;
        const next = items.some((i) => i.product_id === item.product_id)
          ? items.filter((i) => i.product_id !== item.product_id)
          : items.length < MAX
            ? [...items, item]
            : items;
        try {
          localStorage.setItem(compareKey(sid), JSON.stringify(next));
        } catch {}
        setPicks((all) => ({ ...all, [sid]: next }));
      },
    }),
    [items, sid],
  );
  return <TrayContext.Provider value={value}>{children}</TrayContext.Provider>;
}

// one compare pick, a 44 px icon toggle; a full pick list disables adding
export function CompareToggle({ on, full, onToggle }: { on: boolean; full: boolean; onToggle: () => void }) {
  return (
    <Button
      variant="outline"
      size="icon"
      className={cn("size-11 rounded-full bg-card", on && "border-foreground bg-foreground text-background ring-[0.5px] ring-foreground hover:bg-foreground hover:text-background")}
      aria-label={on ? "حذف از مقایسه" : "افزودن به مقایسه"}
      aria-pressed={on}
      disabled={!on && full}
      onClick={onToggle}
    >
      <GitCompareArrows aria-hidden />
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
