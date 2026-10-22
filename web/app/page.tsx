import { FilterChipBar } from "@/components/brief-bar";
import { AgentStart, CategoryTiles, HelpChoose, PasajList, RecentSessions } from "@/components/home-start";

export default function Home() {
  return (
    <>
      <header className="border-b border-hairline bg-card">
        <div className="mx-auto flex h-14 w-full max-w-xl items-center gap-2 px-4">
          <span className="flex size-8 items-center justify-center rounded-lg bg-brand text-base font-bold text-brand-foreground" aria-hidden>
            پ
          </span>
          <h1 className="text-base font-bold">پاساژگرد</h1>
        </div>
      </header>
      <section className="bg-card">
        <div className="mx-auto flex w-full max-w-xl flex-col gap-3 px-4 pt-4">
          <h2 className="text-base font-bold">چه چیزی می‌خواهید حضوری بخرید؟</h2>
          <p className="text-xs text-muted-foreground">قیمت و ساعت کاری فروشگاه‌های پاساژهای تهران، با استعلام از فروشنده</p>
          <AgentStart />
        </div>
      </section>
      <FilterChipBar />
      <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-6 px-4 py-4">
        <RecentSessions />
        <CategoryTiles />
        <PasajList />
        <p className="rounded-xl bg-card p-4 text-xs leading-5">داده‌ها بخشی از فروشگاه‌های تهران، بیشتر مرکز شهر، را پوشش می‌دهند.</p>
        <HelpChoose />
      </main>
    </>
  );
}
