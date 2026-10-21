"use client";

import { useState } from "react";

import { ProductCard } from "@/components/product-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { searchProducts, type ProductCard as Product } from "@/lib/api";

const EXAMPLES = ["هندزفری انکر R50i", "شارژر اپل ۲۰ وات", "کلید مینیاتوری ۱۶ آمپر"];

type State = { status: "idle" } | { status: "loading" } | { status: "error" } | { status: "done"; items: Product[] };

export function ProductSearch() {
  const [query, setQuery] = useState("");
  const [state, setState] = useState<State>({ status: "idle" });

  async function run(q: string) {
    if (!q.trim()) return;
    setQuery(q);
    setState({ status: "loading" });
    try {
      setState({ status: "done", items: await searchProducts(q) });
    } catch {
      setState({ status: "error" });
    }
  }

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
        <Button type="submit" className="h-11 px-5" disabled={state.status === "loading"}>
          جستجو
        </Button>
      </form>

      {state.status === "idle" && (
        <div className="flex flex-wrap gap-2">
          {EXAMPLES.map((q) => (
            <Button key={q} variant="outline" size="sm" onClick={() => run(q)}>
              {q}
            </Button>
          ))}
        </div>
      )}
      {state.status === "loading" && <p className="text-sm text-muted-foreground">در حال جستجو...</p>}
      {state.status === "error" && <p className="text-sm text-destructive">جستجو انجام نشد. دوباره تلاش کنید.</p>}
      {state.status === "done" && state.items.length === 0 && (
        <p className="text-sm text-muted-foreground">
          کالایی پیدا نشد. داده‌ها بخشی از فروشگاه‌های تهران، بیشتر مرکز شهر، را پوشش می‌دهند.
        </p>
      )}
      {state.status === "done" && (
        <ul className="flex flex-col gap-3">
          {state.items.map((p) => (
            <li key={p.product_id}>
              <ProductCard product={p} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
