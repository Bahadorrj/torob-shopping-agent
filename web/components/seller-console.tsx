"use client";

import { useState } from "react";

import { PageTitle } from "@/components/back-header";
import { clock, replyText, STATUS } from "@/components/inquiry-tracker";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { consoleStreamUrl, sendReply, type ConsoleInbox, type ConsoleReply, type Inquiry } from "@/lib/api";
import { faDigits } from "@/lib/format";
import { useEventStream } from "@/lib/use-event-stream";

const QUICK: [string, ConsoleReply][] = [
  ["موجود است", { available: "yes" }],
  ["موجود نیست", { available: "no" }],
  ["اقساط و ترب‌پی قبول می‌کنم", { installments: true }],
  ["اقساط ندارم", { installments: false }],
];

function Incoming({ inquiry: i, token }: { inquiry: Inquiry; token: string }) {
  const [price, setPrice] = useState("");
  const [hold, setHold] = useState("");
  const [text, setText] = useState("");
  const [error, setError] = useState(false);
  // Persian or ASCII digits, with or without separators
  const toman = Number(price.replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d))).replace(/\D/g, ""));

  async function send(reply: ConsoleReply, clear?: () => void) {
    try {
      await sendReply(i.inquiry_id, reply, token);
      setError(false);
      clear?.();
    } catch {
      setError(true);
    }
  }

  return (
    <li className="flex flex-col gap-2 rounded-lg border p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold">{i.product_title}</span>
        <Badge variant="secondary">{STATUS[i.status]}</Badge>
      </div>
      <p className="rounded-md bg-muted p-2">{i.message}</p>
      <ol className="flex flex-col gap-0.5 text-xs text-muted-foreground">
        {i.events
          .filter((e) => e.reply)
          .map((e, n) => (
            <li key={n}>
              {clock(e.at)} - شما: {replyText(e.reply!)}
              {e.question && <p className="mt-0.5 rounded-md bg-muted p-2 text-sm text-foreground">خریدار: {e.question}</p>}
            </li>
          ))}
      </ol>
      <div className="flex flex-wrap gap-1.5">
        {QUICK.map(([label, reply]) => (
          <Button key={label} size="sm" variant="outline" onClick={() => send(reply)}>
            {label}
          </Button>
        ))}
      </div>
      <form
        className="flex gap-1.5"
        onSubmit={(e) => {
          e.preventDefault();
          if (toman > 0) send({ latest_price_toman: toman }, () => setPrice(""));
        }}
      >
        <Input inputMode="numeric" aria-label="قیمت امروز به تومان" placeholder="قیمت امروز (تومان)" value={price} onChange={(e) => setPrice(e.target.value)} />
        <Button type="submit" size="sm" disabled={!(toman > 0)}>
          قیمت امروز: {toman > 0 ? faDigits(toman) : "..."}
        </Button>
      </form>
      <form
        className="flex gap-1.5"
        onSubmit={(e) => {
          e.preventDefault();
          if (hold) send({ hold_until: hold }, () => setHold(""));
        }}
      >
        <Input type="time" aria-label="نگه داشتن تا ساعت" value={hold} onChange={(e) => setHold(e.target.value)} />
        <Button type="submit" size="sm" disabled={!hold}>
          تا ساعت ... نگه می‌دارم
        </Button>
      </form>
      <form
        className="flex gap-1.5"
        onSubmit={(e) => {
          e.preventDefault();
          if (text.trim()) send({ text }, () => setText(""));
        }}
      >
        <Input aria-label="پاسخ آزاد" placeholder="پاسخ آزاد" maxLength={1000} value={text} onChange={(e) => setText(e.target.value)} />
        <Button type="submit" size="sm" disabled={!text.trim()}>
          ارسال
        </Button>
      </form>
      {error && <p className="text-xs text-destructive">پاسخ ارسال نشد. دوباره تلاش کنید.</p>}
    </li>
  );
}

// Demo channel: a person plays the seller of one shop and answers inquiries with quick replies.
// `token`: the shop's console token from its link; without it the API answers 403
export function SellerConsole({ shopId, token }: { shopId: string; token: string }) {
  const inbox = useEventStream<ConsoleInbox>(consoleStreamUrl(shopId, token));
  return (
    <article data-seller-console className="flex flex-col gap-3">
      <p role="note" className="rounded-lg border border-dashed p-2 text-xs">
        شبیه‌سازی: این صفحه در دمو نقش فروشنده را بازی می‌کند و پاسخ‌هایش از فروشنده واقعی نیست.
      </p>
      {inbox && <PageTitle>کنسول فروشنده - {inbox.shop_name}</PageTitle>}
      {inbox === null ? (
        <p className="text-sm text-muted-foreground">در حال بارگذاری...</p>
      ) : inbox.inquiries.length === 0 ? (
        <p className="text-sm text-muted-foreground">هنوز استعلامی نرسیده است.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {inbox.inquiries.map((i) => (
            <Incoming key={i.inquiry_id} inquiry={i} token={token} />
          ))}
        </ul>
      )}
    </article>
  );
}
