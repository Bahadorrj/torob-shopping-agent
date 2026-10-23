"use client";

import { ChevronLeft, Store } from "lucide-react";
import Link from "next/link";

import { OPEN_AREA } from "@/components/brief-bar";
import { useBrief } from "@/components/brief-provider";
import { faText } from "@/lib/format";

// hand-picked from the dataset's largest category_name values
export const CATEGORIES = ["هدفون و هندزفری", "کیف و کاور گوشی", "تاچ و ال‌سی‌دی گوشی", "ساعت مچی", "دوربین مدار بسته", "سیم و کابل برق"];

export function CategoryTiles({ onPick }: { onPick: (category: string) => void }) {
  return (
    <section aria-labelledby="categories" className="flex flex-col gap-3">
      <h2 id="categories" className="text-base font-bold">
        از یک دسته شروع کنید
      </h2>
      <div className="grid grid-cols-2 gap-2">
        {CATEGORIES.map((c) => (
          <button key={c} type="button" className="h-14 rounded-xl bg-card px-4 text-start text-sm font-bold" onClick={() => onPick(c)}>
            {c}
          </button>
        ))}
      </div>
    </section>
  );
}

export function PasajList() {
  const { session } = useBrief();
  if (!session) return null;
  return (
    <section aria-labelledby="pasajs" className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 id="pasajs" className="text-base font-bold">
          پاساژها
        </h2>
        <button type="button" className="-mx-2 flex h-10 items-center px-2 text-sm text-contact" onClick={() => window.dispatchEvent(new Event(OPEN_AREA))}>
          همه مناطق
        </button>
      </div>
      <ul className="flex flex-col divide-y divide-rule overflow-hidden rounded-xl bg-card">
        {session.pasajs.slice(0, 3).map((p) => (
          <li key={p}>
            <Link href={`/pasajs/${encodeURIComponent(p)}`} className="flex items-center gap-3 px-4 py-3">
              <Store className="size-5 shrink-0" aria-hidden />
              <span className="flex flex-1 flex-col">
                <span className="text-sm font-bold">پاساژ {faText(p)}</span>
                <span className="text-xs text-muted-foreground">فروشگاه‌ها به تفکیک طبقه</span>
              </span>
              <ChevronLeft className="size-4" aria-hidden />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
