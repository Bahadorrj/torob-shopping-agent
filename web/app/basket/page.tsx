import { Suspense } from "react";

import { BackHeader } from "@/components/back-header";
import { BasketPlan } from "@/components/basket";

export default function BasketPage({ searchParams }: PageProps<"/basket">) {
  return (
    <>
      <BackHeader title="فهرست خرید" />
      <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-4 px-4 py-6">
        <Suspense fallback={<p className="text-sm text-muted-foreground">در حال بارگذاری...</p>}>
          {searchParams.then((sp) => (
            <BasketPlan text={[sp.text ?? ""].flat().join("\n")} />
          ))}
        </Suspense>
      </main>
    </>
  );
}
