"use client";

import { useRenderTool } from "@copilotkit/react-core/v2";
import Link from "next/link";
import { useState, type ReactNode } from "react";

import { AgentAlternatives } from "@/components/alternatives";
import { BasketView } from "@/components/basket";
import { fold } from "@/components/brief-bar";
import { useBrief } from "@/components/brief-provider";
import { InquiryTracker, withAlternatives } from "@/components/inquiry-tracker";
import { ListedPrice, ProductCard } from "@/components/product-card";
import { Seller } from "@/components/seller-list";
import { hoursText } from "@/components/shop-details";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { clock, OpenBadge, RouteDetails } from "@/components/visit-plan";
import {
  confirmInquiries,
  inquiriesStreamUrl,
  type Alternatives,
  type Basket,
  type Directions,
  type Inquiry,
  type InquiryStatus,
  type ModelPick,
  type ProductCard as Product,
  type ProductCompare,
  type SellerCompare,
  type SellerList,
  type ShopDetails,
  type SitePrice,
  type Shortlist,
  type VisitPlan,
} from "@/lib/api";
import { faDigits, faText, locate } from "@/lib/format";
import { productReasons } from "@/lib/reasons";
import { useEventStream } from "@/lib/use-event-stream";

// One renderer per block type. A block is an agent tool result: `{ block: "<type>", ...tool output }`
// (backend/src/pasazhgard/agent.py). Numbers on screen come from these fields only, never from agent text.
type Chips = { field: string; question: string; options: string[] };

// The block's inquiries as they are now, not as the tool saw them. The tap sends through the REST confirm path:
// consent never goes through the model (ADR-0002 fallback).
function Inquiries({ initial, sites }: { initial: Inquiry[]; sites: SitePrice[] }) {
  // the sheet renders only once the session exists
  const sid = useBrief().session!.session_id;
  // shortcut: one stream per block; share one per session if threads grow many inquiry blocks
  const live = useEventStream<InquiryStatus>(inquiriesStreamUrl(sid));
  const ids = new Set(initial.map((i) => i.inquiry_id));
  const inquiries = live ? withAlternatives(live.inquiries, (i) => ids.has(i.inquiry_id)) : initial;
  const keys = new Set(sites.map((p) => `${p.shop_id} ${p.product_id}`));
  const sitePrices = live ? (live.site_prices ?? []).filter((p) => keys.has(`${p.shop_id} ${p.product_id}`)) : sites;
  return <InquiryTracker sessionId={sid} inquiries={inquiries} sitePrices={sitePrices} onConfirm={(inquiryIds) => confirmInquiries(sid, inquiryIds)} />;
}

// the plan screen's query asks the backend for the same plan; with the session the plan follows its inquiries,
// and the plan screen drops the session from the link it shares
const planHref = (p: VisitPlan, sessionId?: string) =>
  `/plan?${new URLSearchParams([
    ...p.stops.map((s) => ["shop_id", s.shop_id]),
    ["lat", String(p.origin.lat)],
    ["lon", String(p.origin.lon)],
    ["mode", p.mode],
    ["depart_at", p.depart_at],
    ...(sessionId ? [["session_id", sessionId]] : []),
  ])}`;

function PlanLink({ plan }: { plan: VisitPlan }) {
  const sid = useBrief().session?.session_id;
  return (
    <Link href={planHref(plan, sid)} className={linkClass}>
      دیدن برنامه روی نقشه
    </Link>
  );
}

const linkClass = "text-sm font-medium text-primary underline-offset-4 hover:underline";

const compareHref = (ids: string[]) => `/compare?${new URLSearchParams({ ids: ids.join(",") })}`;

function Pick({ m }: { m: ModelPick }) {
  return (
    <Card className="gap-1.5 p-3">
      <h3 className="line-clamp-2 text-sm font-semibold leading-6">{m.title}</h3>
      {m.key_specs.length > 0 && (
        <p className="line-clamp-1 text-xs text-muted-foreground">{m.key_specs.map((s) => `${s.key}: ${s.value}`).join(" · ")}</p>
      )}
      <ListedPrice price={m.price} />
      <p className="text-xs text-muted-foreground">{faDigits(m.seller_count)} فروشنده در این محدوده</p>
      {m.tradeoffs.length > 0 && (
        <ul className="list-disc ps-4 text-xs leading-5">
          {m.tradeoffs.map((t) => (
            <li key={t} className="break-words">
              {faText(t)}
            </li>
          ))}
        </ul>
      )}
      <Link href={`/products/${m.product_id}/sellers`} className={linkClass}>
        دیدن فروشنده‌ها
      </Link>
    </Card>
  );
}

export const BLOCKS: Record<string, (data: never, send: (text: string) => void) => ReactNode> = {
  product_cards: (d: { items: Product[] }) => {
    const items = d.items.slice(0, 5);
    const reasons = productReasons(items);
    return items.length ? (
      <ul className="flex flex-col gap-2">
        {items.map((p, i) => (
          <li key={p.product_id}>
            <ProductCard product={p} reason={reasons[i]} />
          </li>
        ))}
      </ul>
    ) : (
      <p className="text-sm text-muted-foreground">کالایی پیدا نشد.</p>
    );
  },
  model_shortlist: (d: Shortlist) => (
    <div className="flex flex-col gap-2">
      <ul className="flex flex-col gap-2">
        {d.models.map((m) => (
          <li key={m.product_id}>
            <Pick m={m} />
          </li>
        ))}
      </ul>
      {d.models.length > 1 && (
        <Link href={compareHref(d.models.map((m) => m.product_id))} className={linkClass}>
          مقایسه این مدل‌ها
        </Link>
      )}
    </div>
  ),
  seller_list: (d: SellerList) => (
    <div className="flex flex-col gap-2">
      {d.sellers.slice(0, 3).map((s) => (
        <Seller key={s.offer_id} s={s} />
      ))}
      <Link href={`/products/${d.product_id}/sellers`} className={linkClass}>
        همه فروشنده‌های {d.title}
      </Link>
    </div>
  ),
  product: (d: { product_id: string; title: string }) => (
    <div className="flex flex-col gap-1 text-sm">
      <p>{d.title}</p>
      <Link href={`/products/${d.product_id}/sellers`} className={linkClass}>
        دیدن فروشنده‌ها
      </Link>
    </div>
  ),
  shop_details: (d: ShopDetails) => (
    <div className="flex flex-col gap-1 text-sm">
      <p className="font-semibold">{d.name}</p>
      {(d.pasaj || d.floor || d.unit) && (
        <p className="break-words">
          {faText([d.pasaj && `پاساژ ${d.pasaj}`, d.floor && `طبقه ${d.floor}`, d.unit && `واحد ${d.unit}`].filter(Boolean).join("، "))}
        </p>
      )}
      <p>امروز: {hoursText(d.hours.week.find((h) => h.day === d.hours.today)!)}</p>
      <Link href={`/shops/${d.shop_id}`} className={linkClass}>
        ساعت کاری هفته و جزئیات فروشگاه
      </Link>
    </div>
  ),
  compare_table: (d: ProductCompare) => (
    <div className="flex flex-col gap-1 text-sm">
      <p>{d.products.map((p) => p.title).join(" / ")}</p>
      <Link href={compareHref(d.products.map((p) => p.product_id))} className={linkClass}>
        دیدن جدول مقایسه
      </Link>
    </div>
  ),
  seller_compare: (d: SellerCompare) => (
    <div className="flex flex-col gap-1 text-sm">
      <p>{d.sellers.map((s) => s.shop_name).join(" / ")}</p>
      <Link
        href={`/products/${d.product_id}/sellers/compare?${new URLSearchParams(d.sellers.map((s) => ["offer", s.offer_id]))}`}
        className={linkClass}
      >
        مقایسه فروشنده‌ها
      </Link>
    </div>
  ),
  inquiry_status: (d: InquiryStatus) => <Inquiries initial={d.inquiries} sites={d.site_prices ?? []} />,
  visit_plan: (d: VisitPlan) => (
    <div className="flex flex-col gap-1.5 text-sm">
      <ol className="flex flex-col gap-1">
        {d.stops.map((s, i) => (
          <li key={s.shop_id} className="flex flex-wrap items-center gap-1.5">
            <span>
              {faDigits(i + 1)}. {s.shop_name}، رسیدن {clock(s.eta)}
            </span>
            <OpenBadge open={s.open_at_eta} />
          </li>
        ))}
      </ol>
      <PlanLink plan={d} />
    </div>
  ),
  directions: (d: Directions) => (
    <div className="flex flex-col gap-1.5 text-sm">
      <p className="font-semibold">{d.shop_name}</p>
      <RouteDetails d={d} />
    </div>
  ),
  alternatives: (d: Alternatives) => <AgentAlternatives block={d} />,
  basket: (d: Basket) => <BasketView basket={d} />,
  chips: (d: Chips, send) => <ChipsBlock block={d} send={send} />,
};

// A long list (every area and pasaj) shows 8 chips and a search box, so it does not fill the thread
function ChipsBlock({ block, send }: { block: Chips; send: (text: string) => void }) {
  const [query, setQuery] = useState("");
  const [geoError, setGeoError] = useState(false);
  const { session, patch } = useBrief();
  // an origin chip sets the brief's origin first, so the agent's next turn has it
  async function pick(o: string) {
    if (block.field !== "origin") return send(o);
    let origin: { lat: number; lon: number } | undefined;
    if (o === "موقعیت من") {
      try {
        origin = await locate();
      } catch {
        return setGeoError(true);
      }
    } else {
      const c = session?.centers.find((c) => c.name === o);
      origin = c && { lat: c.lat, lon: c.lon };
    }
    setGeoError(false);
    if (origin) await patch({ brief: { origin } });
    send(`مبدأ من: ${o}`);
  }
  const q = fold(query);
  const shown = block.options.filter((o) => fold(o).includes(q)).slice(0, 8);
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm">{block.question}</p>
      {block.options.length > 8 && (
        <Input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="جستجو در گزینه‌ها"
          placeholder="جستجو..."
          className="h-9"
        />
      )}
      <div className="flex flex-wrap gap-1.5" role="group" aria-label={block.question}>
        {shown.map((o) => (
          <Button key={o} variant="outline" size="sm" onClick={() => pick(o)}>
            {o}
          </Button>
        ))}
      </div>
      {!shown.length && <p className="text-sm text-muted-foreground">گزینه‌ای با این نام پیدا نشد</p>}
      {geoError && <p role="alert" className="text-sm text-destructive">موقعیت شما در دسترس نیست. محله یا پاساژ را انتخاب کنید.</p>}
    </div>
  );
}

// the home screen's input, chips and blocks post their text to the sheet through this window event
export const AGENT_SEND = "agent-send";
const toAgent = (text: string) => window.dispatchEvent(new CustomEvent(AGENT_SEND, { detail: text }));

// what the drawer says while each backend tool (backend/src/pasazhgard/agent.py) runs
const BUSY: Record<string, string> = {
  search_products: "در حال جستجوی کالا",
  get_product: "در حال خواندن مشخصات کالا",
  compare_products: "در حال مقایسه مدل‌ها",
  find_sellers: "در حال یافتن فروشنده‌ها",
  compare_sellers: "در حال مقایسه فروشنده‌ها",
  shop_details: "در حال خواندن اطلاعات فروشگاه",
  suggest_models: "در حال انتخاب مدل‌ها",
  plan_visit: "در حال برنامه‌ریزی مسیر",
  get_directions: "در حال مسیریابی",
  find_alternatives: "در حال یافتن جایگزین",
  ask_user: "در حال آماده کردن سؤال",
  contact_seller: "در حال نوشتن پیام‌ها",
  optimize_basket: "در حال چیدن سبد",
  get_inquiries: "در حال خواندن استعلام‌ها",
  fetch_site_price: "در حال خواندن قیمت سایت",
};

// backend tools take their arguments from the model; the drawer only reads the result
const anyArgs = { "~standard": { version: 1, vendor: "pasazhgard", validate: (value: unknown) => ({ value }) } } as const;

function ToolRenderer({ name }: { name: string }) {
  useRenderTool(
    {
      name,
      parameters: anyArgs,
      render: ({ status, result }) =>
        status === "complete" ? (
          <Block content={result} send={toAgent} />
        ) : (
          <div role="status" className="flex flex-col gap-2">
            <p className="text-xs text-muted-foreground">{BUSY[name]}...</p>
            <Skeleton className="h-24 rounded-xl" />
            <Skeleton className="h-24 rounded-xl" />
          </div>
        ),
    },
    [],
  );
  return null;
}

// registers one renderer per backend tool; the thread draws them with useRenderToolCall
export function ToolRenderers() {
  return Object.keys(BUSY).map((name) => <ToolRenderer key={name} name={name} />);
}

export function Block({ content, send }: { content: string; send: (text: string) => void }) {
  let data: { block?: string };
  try {
    data = JSON.parse(content);
  } catch {
    return null;
  }
  // a result without a known block (an error for the model, a newer block type) shows nothing
  const render = data.block ? BLOCKS[data.block] : undefined;
  return render ? render(data as never, send) : null;
}
