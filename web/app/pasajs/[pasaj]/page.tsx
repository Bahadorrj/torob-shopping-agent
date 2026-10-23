import { Suspense } from "react";

import { BackHeader } from "@/components/back-header";
import { PasajView } from "@/components/pasaj-view";

export default function PasajPage({ params, searchParams }: PageProps<"/pasajs/[pasaj]">) {
  return (
    <>
      <BackHeader />
      <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-4 px-4 py-6">
        <Suspense fallback={<p className="text-sm text-muted-foreground">در حال بارگذاری...</p>}>
          {Promise.all([params, searchParams]).then(([{ pasaj }, { product }]) => (
            <PasajView pasaj={decodeURIComponent(pasaj)} productIds={[product ?? []].flat()} />
          ))}
        </Suspense>
      </main>
    </>
  );
}
