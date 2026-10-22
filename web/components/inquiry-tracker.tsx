"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { Alternatives } from "@/components/alternatives";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { askAlternative, confirmInquiries, getAlternatives, type Alternatives as Block, type ConsoleReply, type Inquiry, type InquiryState } from "@/lib/api";
import { faDigits, faText } from "@/lib/format";

export const STATUS: Record<InquiryState, string> = {
  draft: "پیش‌نویس",
  closed: "فروشگاه الان بسته است",
  queued: "هنگام باز شدن فرستاده می‌شود",
  sent: "ارسال شد، منتظر پاسخ",
  replied: "پاسخ داد",
  confirmed: "موجودی تأیید شد",
  unavailable: "موجود نیست",
  no_reply: "پاسخ نداد",
};

const FELL_THROUGH: InquiryState[] = ["unavailable", "no_reply", "closed"];

// shown as soon as an inquiry falls through; fetched again only when its status changes
function FallenThrough({ sessionId, inquiry }: { sessionId: string; inquiry: Inquiry }) {
  const [block, setBlock] = useState<Block | null>(null);
  const { inquiry_id, status } = inquiry;
  useEffect(() => {
    getAlternatives(sessionId, inquiry_id).then(setBlock, () => setBlock(null));
  }, [sessionId, inquiry_id, status]);
  return block && <Alternatives block={block} onAsk={(a) => askAlternative(sessionId, a)} />;
}

// an ISO time from the API, in Tehran time, as HH:MM
export const clock = (at: string) => faText(at.slice(11, 16));

// what the seller sent, in the seller's words
export function replyText(r: ConsoleReply) {
  const parts = [];
  if (r.available) parts.push(r.available === "yes" ? "موجود است" : "موجود نیست");
  if (r.latest_price_toman) parts.push(`قیمت امروز: ${faDigits(r.latest_price_toman)} تومان`);
  if (r.hold_until) parts.push(`تا ساعت ${faText(r.hold_until.slice(0, 5))} نگه می‌دارم`);
  if (r.installments !== undefined) parts.push(r.installments ? "اقساط و ترب‌پی قبول می‌کنم" : "اقساط ندارم");
  if (r.text) parts.push(r.text);
  return parts.join("، ");
}

function Sent({ sessionId, inquiry: i }: { sessionId: string; inquiry: Inquiry }) {
  const { reply } = i;
  const repliedAt = i.events.findLast((e) => e.reply)?.at;
  return (
    <li className="flex flex-col gap-1.5 rounded-lg border p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold">{i.shop_name}</span>
        <Badge variant={i.status === "confirmed" ? "default" : FELL_THROUGH.includes(i.status) ? "destructive" : "secondary"}>
          {STATUS[i.status]}
        </Badge>
        {i.simulated && <Badge variant="outline">شبیه‌سازی</Badge>}
      </div>
      {reply.latest_price_toman !== null && repliedAt && (
        <p>
          قیمت تأییدشده توسط فروشنده: <span className="font-bold">{faDigits(reply.latest_price_toman)} تومان</span> - ساعت{" "}
          {clock(repliedAt)}
        </p>
      )}
      {reply.hold_until && <p>نگه می‌دارد تا ساعت {faText(reply.hold_until.slice(0, 5))}</p>}
      {reply.installments !== null && <p>{reply.installments ? "اقساط یا ترب‌پی: دارد (تأیید فروشنده)" : "اقساط ندارد"}</p>}
      <ol className="flex flex-col gap-0.5 border-s-2 ps-2 text-xs text-muted-foreground">
        {i.events
          .filter((e) => e.status !== "draft")
          .map((e, n) => (
            <li key={n}>
              {clock(e.at)} - {e.reply ? `فروشنده: ${replyText(e.reply)}` : e.status === "sent" ? "پیام ارسال شد" : STATUS[e.status]}
              {e.question && ` - سؤال تکمیلی: ${e.question}`}
            </li>
          ))}
      </ol>
      {i.status === "closed" && (
        <Button size="xs" variant="outline" className="h-auto self-start py-1 whitespace-normal" onClick={() => confirmInquiries(sessionId, [i.inquiry_id], true)}>
          هنگام باز شدن بفرست
        </Button>
      )}
      {FELL_THROUGH.includes(i.status) && <FallenThrough sessionId={sessionId} inquiry={i} />}
      {i.simulated && (
        <Link href={`/console/${i.shop_id}`} target="_blank" className="text-xs text-primary underline-offset-4 hover:underline">
          کنسول فروشنده (شبیه‌سازی)
        </Link>
      )}
    </li>
  );
}

// The inquiry_status block: drafts waiting for consent, then a timeline per shop.
export function InquiryTracker({
  sessionId,
  inquiries,
  onConfirm,
}: {
  sessionId: string;
  inquiries: Inquiry[];
  onConfirm: (ids: number[]) => Promise<unknown>;
}) {
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(false);
  const drafts = inquiries.filter((i) => i.status === "draft");
  const sent = inquiries.filter((i) => i.status !== "draft");

  async function confirm() {
    setSending(true);
    try {
      await onConfirm(drafts.map((d) => d.inquiry_id));
      setError(false);
    } catch {
      setError(true);
    } finally {
      setSending(false);
    }
  }

  return (
    <section className="flex flex-col gap-3" aria-label="استعلام‌ها">
      {drafts.length > 0 && (
        <div className="flex flex-col gap-2 rounded-lg bg-muted p-3 text-sm">
          <h2 className="font-bold">پیش‌نویس پیام‌ها</h2>
          <p className="text-xs text-muted-foreground">تا وقتی تأیید نکنید، پیامی برای فروشنده فرستاده نمی‌شود.</p>
          <ul className="flex flex-col gap-2">
            {drafts.map((d) => (
              <li key={d.inquiry_id} className="flex flex-col gap-0.5">
                <span className="font-semibold">{d.shop_name}</span>
                <span>{d.message}</span>
              </li>
            ))}
          </ul>
          <Button onClick={confirm} disabled={sending} className="h-auto py-1.5 whitespace-normal">
            ارسال به {faDigits(drafts.length)} فروشنده
          </Button>
          {error && <p className="text-xs text-destructive">ارسال نشد. دوباره تلاش کنید.</p>}
        </div>
      )}
      {sent.length > 0 && (
        <>
          <h2 className="font-bold">پیگیری استعلام‌ها</h2>
          <ul className="flex flex-col gap-2">
            {sent.map((i) => (
              <Sent key={i.inquiry_id} sessionId={sessionId} inquiry={i} />
            ))}
          </ul>
          {sent.some((i) => i.simulated) && (
            <p className="text-xs text-muted-foreground">پاسخ‌ها در این دمو از کنسول فروشنده می‌آیند و شبیه‌سازی هستند.</p>
          )}
        </>
      )}
    </section>
  );
}
