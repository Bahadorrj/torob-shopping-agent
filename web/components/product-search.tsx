"use client";

import { useEffect, useState } from "react";

import { useBrief } from "@/components/brief-provider";
import { CompareTrayBar } from "@/components/compare-tray";
import { ProductCard } from "@/components/product-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const EXAMPLES = ["هندزفری انکر R50i", "شارژر اپل ۲۰ وات", "کلید مینیاتوری ۱۶ آمپر"];

export function ProductSearch() {
  const { session, pending, error, patch } = useBrief();
  const [query, setQuery] = useState("");
  const sid = session?.session_id;
  const need = session?.brief.need;

  const [shownSid, setShownSid] = useState<string>();

  // coming back (or resuming a session) restores the last search; the brief keeps it as the need
  if (sid !== shownSid) {
    setShownSid(sid);
    if (need) setQuery(need);
  }
  useEffect(() => {
    if (sid && need) patch({ step: { kind: "search" } });
  }, [sid]); // eslint-disable-line react-hooks/exhaustive-deps

  function run(q: string) {
    if (!q.trim()) return;
    setQuery(q);
    patch({ brief: { need: q }, step: { kind: "search" } });
  }

  const results = session?.step?.kind === "search" && session.results && "items" in session.results ? session.results.items : null;
  const status = pending ? "loading" : error && query ? "error" : results ? "done" : "idle";

  return (
    <div className="flex flex-col gap-4">
      <form
        role="search"
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          run(query);
        }}
      >
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="نام کالا را بنویسید"
          aria-label="جستجوی کالا"
          className="h-11"
        />
        <Button type="submit" className="h-11 px-5" disabled={status === "loading"}>
          جستجو
        </Button>
      </form>

      {status === "idle" && (
        <div className="flex flex-wrap gap-2">
          {EXAMPLES.map((q) => (
            <Button key={q} variant="outline" size="sm" onClick={() => run(q)}>
              {q}
            </Button>
          ))}
        </div>
      )}
      {status === "loading" && <p className="text-sm text-muted-foreground">در حال جستجو...</p>}
      {status === "error" && <p className="text-sm text-destructive">جستجو انجام نشد. دوباره تلاش کنید.</p>}
      {status === "done" && results!.length === 0 && (
        <p className="text-sm text-muted-foreground">
          کالایی پیدا نشد. داده‌ها بخشی از فروشگاه‌های تهران، بیشتر مرکز شهر، را پوشش می‌دهند.
        </p>
      )}
      {status === "done" && (
        <ul className="flex flex-col gap-3">
          {results!.map((p) => (
            <li key={p.product_id}>
              <ProductCard product={p} />
            </li>
          ))}
        </ul>
      )}
      <CompareTrayBar />
    </div>
  );
}
