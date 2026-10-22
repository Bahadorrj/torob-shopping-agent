"use client";

import { ChevronLeft, History, MessageCircle, Search, Store } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { AGENT_SEND, HELP_CHOOSE } from "@/components/agent-sheet";
import { OPEN_AREA } from "@/components/brief-bar";
import { recentSessionIds, useBrief } from "@/components/brief-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getSession, type Session } from "@/lib/api";
import { faText } from "@/lib/format";

// hand-picked from the dataset's largest category_name values
const CATEGORIES = ["هدفون و هندزفری", "کیف و کاور گوشی", "تاچ و ال‌سی‌دی گوشی", "ساعت مچی", "دوربین مدار بسته", "سیم و کابل برق"];

const toAgent = (text: string) => window.dispatchEvent(new CustomEvent(AGENT_SEND, { detail: text }));

// the home screen's main input (PRD 9): one sentence to the agent, which answers in the drawer
export function AgentStart() {
  const [text, setText] = useState("");
  const router = useRouter();
  return (
    <form
      className="flex h-12 items-center gap-2 rounded-lg bg-muted p-1 ps-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!text.trim()) return;
        toAgent(text);
        setText("");
      }}
    >
      <Input
        value={text}
        onChange={(e) => setText(e.target.value)}
        // a one-line input drops newlines, so a pasted multi-line list goes to basket mode before it lands
        onPaste={(e) => {
          const pasted = e.clipboardData.getData("text");
          if (!pasted.trim().includes("\n")) return;
          e.preventDefault();
          router.push(`/basket?${new URLSearchParams({ text: pasted })}`);
        }}
        placeholder="مثلا هندزفری بلوتوثی برای ورزش"
        aria-label="خرید شما در یک جمله"
        className="h-full border-0 bg-transparent px-0 shadow-none focus-visible:ring-0"
      />
      <Button type="submit" variant="buy" size="icon" aria-label="بپرس" className="size-10 shrink-0 rounded-lg">
        <Search />
      </Button>
    </form>
  );
}

export function CategoryTiles() {
  return (
    <section aria-labelledby="categories" className="flex flex-col gap-3">
      <h2 id="categories" className="text-base font-bold">
        از یک دسته شروع کنید
      </h2>
      <div className="grid grid-cols-2 gap-2">
        {CATEGORIES.map((c) => (
          <button key={c} type="button" className="h-14 rounded-xl bg-card px-4 text-start text-sm font-bold" onClick={() => toAgent(`${c} می‌خواهم`)}>
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
        <button type="button" className="text-sm text-contact" onClick={() => window.dispatchEvent(new Event(OPEN_AREA))}>
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

function label(s: Session) {
  return s.brief.need ?? (s.step?.kind === "sellers" ? s.step.title : null) ?? null;
}

export function HelpChoose() {
  return (
    <Button variant="secondary" className="h-12 justify-start gap-2 bg-card" onClick={() => toAgent(HELP_CHOOSE)}>
      <MessageCircle aria-hidden />
      {HELP_CHOOSE}
    </Button>
  );
}

export function RecentSessions() {
  const { session, resume } = useBrief();
  const router = useRouter();
  const [recent, setRecent] = useState<Session[]>([]);
  const current = session?.session_id;

  useEffect(() => {
    if (!current) return;
    const ids = recentSessionIds().filter((id) => id !== current);
    Promise.all(ids.map((id) => getSession(id).catch(() => null))).then((all) =>
      setRecent(all.filter((s): s is Session => s !== null && label(s) !== null)),
    );
  }, [current]);

  if (recent.length === 0) return null;
  return (
    <section aria-labelledby="recent" className="flex flex-col gap-2">
      <h2 id="recent" className="sr-only">
        جلسه‌های اخیر
      </h2>
      {recent.map((s) => (
        <button
          key={s.session_id}
          type="button"
          className="flex items-center gap-3 rounded-xl bg-card px-4 py-3 text-start"
          onClick={async () => {
            const resumed = await resume(s.session_id);
            if (resumed?.step?.kind === "sellers") router.push(`/products/${resumed.step.product_id}/sellers`);
          }}
        >
          <History className="size-5 shrink-0" aria-hidden />
          <span className="min-w-0 flex-1 truncate text-sm font-bold">{label(s)}</span>
          <span className="text-xs text-muted-foreground">ادامه</span>
        </button>
      ))}
    </section>
  );
}
