import { ProductSearch } from "@/components/product-search";

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-4 px-4 py-6">
      <h1 className="text-xl font-bold">پاساژگرد</h1>
      <ProductSearch />
    </main>
  );
}
