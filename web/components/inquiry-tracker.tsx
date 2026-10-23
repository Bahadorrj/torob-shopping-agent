"use client";

import { useEffect, useState } from "react";

import { Alternatives } from "@/components/alternatives";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { askAlternative, composeInquiries, confirmInquiries, getAlternatives, type SitePrice, type Alternatives as Block, type ConsoleReply, type Inquiry, type InquiryState } from "@/lib/api";
import { faDigits, faText } from "@/lib/format";

export const STATUS: Record<InquiryState, string> = {
  draft: "پیش‌نویس",
  closed: "فروشگاه الان بسته است",
  queued: "هنگام باز شدن فرستاده می‌شود",
  sent: "درخواست ارسال شد · موجودی تأیید نشده",
  replied: "پاسخ داد · موجودی تأیید نشده",
  confirmed: "موجودی تأیید شد",
  unavailable: "موجود نیست",
  no_reply: "پاسخ نداد · موجودی تأیید نشده",
};

export const FELL_THROUGH: InquiryState[] = ["unavailable", "no_reply", "closed"];

// shown as soon as an inquiry falls through; fetched again only when its status changes
function FallenThrough({ sessionId, inquiry }: { sessionId: string; inquiry: Inquiry }) {
  const [block, setBlock] = useState<Block | null>(null);
  const { inquiry_id, status } = inquiry;
  useEffect(() => {
    getAlternatives(sessionId, inquiry_id).then(setBlock, () => setBlock(null));
  }, [sessionId, inquiry_id, status]);
  return block && <Alternatives block={block} onAsk={(a) => askAlternative(sessionId, a, inquiry_id)} />;
}

// the inquiries `keep` picks plus the alternatives asked in place of them, at any depth; `all` is oldest first,
// so an alternative comes after the inquiry it stands in for
export function withAlternatives(all: Inquiry[], keep: (i: Inquiry) => boolean) {
  const ids = new Set(all.filter(keep).map((i) => i.inquiry_id));
  for (const i of all) if (i.instead_of && ids.has(i.instead_of)) ids.add(i.inquiry_id);
  return all.filter((i) => ids.has(i.inquiry_id));
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

function Sent({ sessionId, inquiry: i, original }: { sessionId: string; inquiry: Inquiry; original?: Inquiry }) {
  const { reply } = i;
  const repliedAt = i.events.findLast((e) => e.reply)?.at;
  return (
    <li className="flex flex-col gap-1.5 rounded-lg border p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-bold">{i.shop_name}</span>
        <Badge variant={i.status === "confirmed" ? "default" : FELL_THROUGH.includes(i.status) ? "destructive" : "secondary"}>
          {STATUS[i.status]}
        </Badge>
        {i.simulated && <Badge variant="outline">شبیه‌سازی</Badge>}
      </div>
      {original && (
        <p className="text-xs text-muted-foreground">
          به جای {original.shop_name}
          {i.product_id !== original.product_id && ` - کالای مشابه: ${i.product_title}`}
        </p>
      )}
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
              {clock(e.at)} - {e.reply ? `فروشنده: ${replyText(e.reply)}` : e.status === "sent" ? "درخواست ارسال شد" : STATUS[e.status]}
              {e.question && ` - سؤال تکمیلی: ${e.question}`}
            </li>
          ))}
      </ol>
      {i.status === "closed" && (
        <Button size="tap" variant="outline" className="self-start" onClick={() => confirmInquiries(sessionId, [i.inquiry_id], true)}>
          هنگام باز شدن بفرست
        </Button>
      )}
      {FELL_THROUGH.includes(i.status) && <FallenThrough sessionId={sessionId} inquiry={i} />}
    </li>
  );
}

// the user sends the message themselves; no recipient, since the dataset's numbers are not real
function SendYourself({ message }: { message: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(message);
    setCopied(true);
  };
  // Bale has no documented prefill link; the system share sheet hands it the text where installed
  const share = () => (navigator.share ? navigator.share({ text: message }).catch(() => {}) : copy());
  return (
    <div className="flex flex-wrap gap-1.5">
      <Button size="tap" variant="outline" onClick={copy}>
        {copied ? "کپی شد" : "کپی پیام"}
      </Button>
      <a href={`https://wa.me/?text=${encodeURIComponent(message)}`} target="_blank" rel="noreferrer" className={buttonVariants({ size: "tap", variant: "outline" })}>
        واتس‌اپ
      </a>
      <Button size="tap" variant="outline" onClick={share}>
        بله و دیگر برنامه‌ها
      </Button>
    </div>
  );
}

// a failed fetch offers the inquiry instead; the shop is asked about the item as an ask, whatever it lists
function Site({ sessionId, price: p }: { sessionId: string; price: SitePrice }) {
  return (
    <li className="flex flex-col gap-1.5 rounded-lg border p-3 text-sm">
      <span className="font-bold">{p.shop_name}</span>
      {p.status === "found" && p.price_toman !== null ? (
        <p>
          قیمت سایت: <span className="font-bold">{faDigits(p.price_toman)} تومان</span> - ساعت {clock(p.fetched_at)} - موجودی تأیید نشده
        </p>
      ) : (
        <>
          <p className="text-muted-foreground">قیمت سایت در دسترس نبود</p>
          <Button
            size="tap"
            variant="outline"
            className="self-start"
            onClick={() => composeInquiries(sessionId, [], [{ product_id: p.product_id, shop_id: p.shop_id }])}
          >
            استعلام از {p.shop_name}
          </Button>
        </>
      )}
    </li>
  );
}

// The inquiry_status block: drafts waiting for consent, then a timeline per shop, then website prices.
export function InquiryTracker({
  sessionId,
  inquiries,
  sitePrices = [],
  onConfirm,
}: {
  sessionId: string;
  inquiries: Inquiry[];
  sitePrices?: SitePrice[];
  onConfirm: (ids: number[]) => Promise<unknown>;
}) {
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(false);
  const drafts = inquiries.filter((i) => i.status === "draft");
  const sent = inquiries.filter((i) => i.status !== "draft");

  async function confirm(ids: number[]) {
    setSending(true);
    try {
      await onConfirm(ids);
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
          <h2 className="font-bold">درخواست موجودی</h2>
          <p className="text-xs text-muted-foreground">تا وقتی تأیید نکنید، پیامی برای فروشنده فرستاده نمی‌شود.</p>
          <ul className="flex flex-col gap-2">
            {drafts.map((d) => (
              <li key={d.inquiry_id} className="flex flex-col gap-1.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-bold">{d.shop_name}</span>
                  <Button size="tap" variant="outline" disabled={sending} onClick={() => confirm([d.inquiry_id])}>
                    ارسال درخواست موجودی
                  </Button>
                </div>
                <details className="text-xs">
                  <summary className="cursor-pointer py-3 leading-5 text-muted-foreground">خودم می‌فرستم</summary>
                  <div className="flex flex-col gap-1.5 pt-1.5">
                    <SendYourself message={d.message} />
                    <p className="text-muted-foreground">شماره‌های تماس فروشگاه‌ها در داده‌های این دمو واقعی نیستند.</p>
                  </div>
                </details>
              </li>
            ))}
          </ul>
          {drafts.length > 1 && (
            <Button onClick={() => confirm(drafts.map((d) => d.inquiry_id))} disabled={sending} className="h-auto min-h-11 py-1.5 whitespace-normal">
              ارسال به {faDigits(drafts.length)} فروشنده
            </Button>
          )}
          {error && <p className="text-xs text-destructive">ارسال نشد. دوباره تلاش کنید.</p>}
        </div>
      )}
      {sent.length > 0 && (
        <>
          <h2 className="font-bold">پیگیری استعلام‌ها</h2>
          <ul className="flex flex-col gap-2">
            {sent.map((i) => (
              <Sent key={i.inquiry_id} sessionId={sessionId} inquiry={i} original={inquiries.find((o) => o.inquiry_id === i.instead_of)} />
            ))}
          </ul>
          {sent.some((i) => i.simulated) && (
            <p className="text-xs text-muted-foreground">پاسخ‌ها در این دمو از کنسول فروشنده می‌آیند و شبیه‌سازی هستند.</p>
          )}
        </>
      )}
      {sitePrices.length > 0 && (
        <>
          <h2 className="font-bold">قیمت سایت فروشنده‌ها</h2>
          <ul className="flex flex-col gap-2">
            {sitePrices.map((p) => (
              <Site key={p.shop_id} sessionId={sessionId} price={p} />
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
