import { Suspense } from "react";

import { BackHeader } from "@/components/back-header";
import { FilterChipBar } from "@/components/brief-bar";
import { ProductCompare } from "@/components/product-compare";

export default function ComparePage({ searchParams }: PageProps<"/compare">) {
  return (
    <>
      <BackHeader title="مقایسه کالاها" />
      <FilterChipBar />
      <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-4 px-4 py-6">
        <Suspense fallback={<p className="text-sm text-muted-foreground">در حال بارگذاری...</p>}>
          {searchParams.then(({ ids }) => (
            <ProductCompare ids={String(ids ?? "").split(",").filter(Boolean)} />
          ))}
        </Suspense>
      </main>
    </>
  );
}
