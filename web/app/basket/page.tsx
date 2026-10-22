import { Suspense } from "react";

import { BasketPlan } from "@/components/basket";

export default function BasketPage({ searchParams }: PageProps<"/basket">) {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-4 px-4 py-6">
      <h1 className="text-xl font-bold">فهرست خرید</h1>
      <Suspense fallback={<p className="text-sm text-muted-foreground">در حال بارگذاری...</p>}>
        {searchParams.then((sp) => (
          <BasketPlan text={[sp.text ?? ""].flat().join("\n")} />
        ))}
      </Suspense>
    </main>
  );
}
