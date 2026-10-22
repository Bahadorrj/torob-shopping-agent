"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { AGENT_SEND, HELP_CHOOSE } from "@/components/agent-sheet";
import { recentSessionIds, useBrief } from "@/components/brief-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getSession, type Session } from "@/lib/api";
import { locate } from "@/lib/format";

const NEAR_ME_M = 1000;

const EXAMPLES = [
  "یه هندزفری بلوتوثی برای باشگاه میخوام، حوالی جمهوری، ساعت ۵ عصر، قسطی",
  "شارژر ۲۰ وات اپل تا ۸۰۰ هزار تومان، امروز توی پاساژ علاالدین",
  "کلید مینیاتوری ۱۶ آمپر می‌خوام، فردا صبح، نقدی",
];

const toAgent = (text: string) => window.dispatchEvent(new CustomEvent(AGENT_SEND, { detail: text }));

// the home screen's main input (PRD 9): one sentence to the agent, which answers in the sheet
export function AgentStart() {
  const [text, setText] = useState("");
  const router = useRouter();
  return (
    <div className="flex flex-col gap-2">
      <form
        className="flex gap-2"
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
          placeholder="چه می‌خواهید، کجا و کی؟"
          aria-label="خرید شما در یک جمله"
          className="h-11"
        />
        <Button type="submit" className="h-11 px-5">
          بپرس
        </Button>
      </form>
      <div className="flex flex-col items-start gap-2">
        {EXAMPLES.map((q) => (
          <Button key={q} variant="outline" size="sm" className="h-auto max-w-full py-1.5 text-start whitespace-normal" onClick={() => toAgent(q)}>
            {q}
          </Button>
        ))}
      </div>
    </div>
  );
}

function label(s: Session) {
  return s.brief.need ?? (s.step?.kind === "sellers" ? s.step.title : null) ?? null;
}

export function HelpChoose() {
  return (
    <Button size="sm" className="self-start" onClick={() => toAgent(HELP_CHOOSE)}>
      {HELP_CHOOSE}
    </Button>
  );
}

export function NearMe() {
  const { session, patch } = useBrief();
  const [geoError, setGeoError] = useState(false);
  const on = session?.brief.area?.radius_m != null;
  return (
    <div className="flex flex-col gap-1">
      <Button
        variant={on ? "default" : "outline"}
        size="sm"
        aria-pressed={on}
        className="self-start"
        onClick={async () => {
          try {
            const origin = await locate();
            setGeoError(false);
            patch({ brief: { origin, area: { radius_m: NEAR_ME_M } } });
          } catch {
            setGeoError(true);
          }
        }}
      >
        نزدیک من
      </Button>
      {geoError && <p className="text-xs text-destructive">موقعیت شما در دسترس نیست. محله یا پاساژ را از نوار بالا انتخاب کنید.</p>}
    </div>
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
      <h2 id="recent" className="text-sm font-semibold">
        جلسه‌های اخیر
      </h2>
      <div className="flex flex-wrap gap-2">
        {recent.map((s) => (
          <Button
            key={s.session_id}
            variant="outline"
            size="sm"
            className="max-w-full truncate"
            onClick={async () => {
              const resumed = await resume(s.session_id);
              if (resumed?.step?.kind === "sellers") router.push(`/products/${resumed.step.product_id}/sellers`);
            }}
          >
            {label(s)}
          </Button>
        ))}
      </div>
    </section>
  );
}
