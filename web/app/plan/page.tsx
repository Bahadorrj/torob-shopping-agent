import { Suspense } from "react";

import { BackHeader } from "@/components/back-header";
import { VisitPlan } from "@/components/visit-plan";

export default function PlanPage({ searchParams }: PageProps<"/plan">) {
  return (
    <>
      <BackHeader title="برنامه مراجعه" />
      <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-4 px-4 py-6">
        <Suspense fallback={<p className="text-sm text-muted-foreground">در حال بارگذاری...</p>}>
          {searchParams.then((sp) => (
            <VisitPlan query={new URLSearchParams(Object.entries(sp).flatMap(([k, v]) => [v ?? []].flat().map((x) => [k, x]))).toString()} />
          ))}
        </Suspense>
      </main>
    </>
  );
}
