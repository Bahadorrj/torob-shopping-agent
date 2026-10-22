# Design direction: Pasazhgard in Torob's clothes

Torob's look (slate ink on a `#f1f5f9` ground, white flat cards, red only for buying) on top of
borrowed patterns: Maps (list/map toggle, open now, distance), Snapp/Divar (bottom sheets, filter chips),
Perplexity/Rufus (answers end in cards and suggestion chips). Sources: `torob-reference.md`,
`current-audit.md`, PRD 8-9. Mocks at 360 px: `mocks/home.html`, `mocks/results.html`, `mocks/chat.html`
(+ `.png`). Mock product photos are Torob CDN images from `dataset/products.csv`; shop names, prices and
dates come from `dataset/offers.csv`. Distances, hours and the inquiry states are made up.

Style: tasteskill app style `achromatic-ledger` (seed 1482434642), brand kept. The brand overrides two
of its defaults: the screen's one CTA is brand red rather than near-black, and contact actions are
Torob blue. Torob's gradient buttons are flat here: the flat fill is the end colour of the gradient.

## 1. Tokens (`web/app/globals.css`)

Replace the `:root` block. Primary stays ink: shadcn's default `Button` and selected toggles are slate,
so red cannot spread by accident. Red and blue are new tokens behind their own button variants.
Drop `.dark` (Torob light only; no dark toggle in scope).

```css
:root {
  --background: #f1f5f9; --foreground: #1e293b;  /* page ground, ink */
  --card: #ffffff; --card-foreground: #1e293b; --popover: #ffffff; --popover-foreground: #1e293b;
  --primary: #1e293b; --primary-foreground: #ffffff;  /* ink: default buttons, pressed chips */
  --secondary: #f1f5f9; --secondary-foreground: #1e293b; --accent: #f1f5f9; --accent-foreground: #1e293b;
  --muted: #f1f5f9; --muted-foreground: #64748b; --destructive: #e02020;
  --border: #cbd5e1; --input: #cbd5e1; --ring: #3468cc;
  --rule: #f1f5f9; --hairline: #e2e8f0;  /* row dividers; slot frame */
  --brand: #d73948; --brand-foreground: #ffffff;  /* the one buy/CTA per screen */
  --contact: #3468cc; --contact-foreground: #ffffff;  /* استعلام, مسیر */
  --open: #4caf50; --closed: #e02020; --confirmed: #daf2d5; --confirmed-foreground: #0b5124;
  --notice-foreground: #92400e;  /* old price (>30 days) */
  --radius: 0.5rem;  /* 8: buttons, inputs, image wells */
}
@theme inline {  /* additions; keep the existing mappings */
  --color-brand: var(--brand); --color-brand-foreground: var(--brand-foreground);
  --color-contact: var(--contact); --color-contact-foreground: var(--contact-foreground);
  --color-open: var(--open); --color-closed: var(--closed); --color-rule: var(--rule);
  --color-hairline: var(--hairline); --color-confirmed: var(--confirmed);
  --color-confirmed-foreground: var(--confirmed-foreground); --color-notice-foreground: var(--notice-foreground);
  --radius-xl: calc(var(--radius) * 2);  /* 16: Card uses rounded-xl */
}
```

- `ui/card.tsx`: drop `ring-1 ring-foreground/10` (no border, no shadow; white on grey is the edge).
- `ui/button.tsx`: add variants `buy` (`bg-brand text-brand-foreground`), `contact`
  (`bg-contact text-contact-foreground`), `contact-outline` (`border-contact text-contact bg-card`); add
  size `row` = `h-10 px-4 text-sm font-bold` (Torob's 40 px row buttons; 44 px tap area with the gap).
- Contrast: `#64748b` reads 4.76:1 on white, but 4.3:1 on `#f1f5f9`. Muted text goes only on white
  surfaces. Text on the grey ground is ink. The inspector caught this. Placeholders inside the grey
  search field are the one exception, as on Torob.
- `--open #4caf50` is 2.8:1 on white, so it is never text. It colours an 8 px dot, and the label
  ("الان باز") stays ink. `--closed` passes and may colour the word "بسته".

## 2. Type

Vazirmatn Variable, used only at 400 and 700. Sizes are 12, 14 and 16: 16/28 for titles, shop names
and the seller price; 14/24 for body, chips and buttons; 12/20 for meta. Product titles wrap to two
lines (`line-clamp-2`). Latin model names stay Latin. No size above 16, so the page title is 16/700 in
the app bar. Every number gets `tabular-nums`.

## 3. Formatting (`web/lib/format.ts`)

- `faDigits` uses `Intl.NumberFormat("fa-IR")`, whose separator is U+066C `٬`, but Torob uses U+066B
  `٫`. So `faDigits` swaps `٬` for `٫`, and every number on screen goes through it.
- `toman(n)` returns `"۳٫۳۴۰٫۰۰۰ تومان"` and `fromToman(n)` returns `"از ۳٫۳۴۰٫۰۰۰ تومان"` for the
  lowest of many. No range form ("X تا Y"), which follows Torob. Per-meter prices add "هر متر".
- `UNKNOWN = "نامشخص"` is the only word for a missing value, always muted. It replaces "ثبت نشده",
  "قیمت ثبت نشده", "مکان ثبت نشده" and `NotRecorded`. Forms: "قیمت: نامشخص", "موجودی: نامشخص",
  "ساعت کاری: نامشخص".
- `priceAge(days)` returns the value of the age slot: "امروز", "۱۵ روز پیش", or "۵ ماه پیش" from 60
  days. The slot is labelled "آخرین تغییر قیمت". Over 30 days it adds "، قدیمی" in
  `--notice-foreground`. When days is null it returns "نامشخص". Never "به‌روز شده".
- `openLabel(open_now)`: "الان باز" with a green dot, "بسته" in `--closed`, "ساعت کاری: نامشخص" for
  null. `SellerRow` has no closing time, so no "تا ۲۰:۰۰". `distance(m)` is unchanged.

## 4. Components (360 px)

### ResultCard: seller row (`seller-list.tsx` `Seller`, used by `agent-blocks.tsx` `seller_list`)

```
+ 8 ----------------------------------------- 8 +  page #f1f5f9, cards 8 px apart
| دیسینا نیکیس                       [ارزان‌ترین] |  name 16/700 links to /shops; reason badge
| پاساژ علاءالدین، طبقه منفی ۲ · ۲۲۰ متر · ● الان باز | 12 muted; dot + ink label
| ۳٫۳۴۰٫۰۰۰ تومان                    قیمت ثبت‌شده |  PRICE slot: 16/700, source 12 muted
| +---------------------+--------------------+ |
| | آخرین تغییر قیمت      | موجودی              | |  AGE slot | AVAILABILITY slot
| | ۱۵ روز پیش           | نامشخص              | |  1px --hairline frame, r8, white
| +---------------------+--------------------+ |
| [ استعلام بگیرید (contact) ]   ➤ مسیر  □ مقایسه |  one primary, ghost route, compare check
+----------------------------------------------+  card r16, padding 16, gap 8
```

- The price slot shows the confirmed price when there is one (`latest_price.status=confirmed`, source
  "قیمت فروشنده، ساعت ۱۱:۴۲"), else the website price ("قیمت سایت فروشنده، ساعت …"), else the listed
  price ("قیمت ثبت‌شده"), else "قیمت: نامشخص". When the confirmed price differs from the listed one, a
  12 px line under the slots says "قیمت ثبت‌شده X بود. پاسخ فروشنده شبیه‌سازی است."
- The age slot refers to the price shown in the price slot. For a confirmed price it shows the reply day.
- The availability slot is filled only from `inquiry`: "نامشخص" (none), "در انتظار پاسخ" (sent),
  "موجود است" (`available=yes`, `--confirmed-foreground` 700), "ناموجود" (ink, no red), "پاسخ نداد",
  "الان بسته است".
- Payment goes in the meta line as words: "ترب‌پی حضوری" or "اسنپ‌پی". Never "اقساط …" for every provider.
- shadcn: `Card`, `Badge` (reason, `variant="secondary"` + `rounded-full font-bold`), `Button`
  (`contact`/`ghost`, size `row`), `Checkbox`-like `Toggle` for compare (existing `CompareToggle`).

### ProductCard (`product-card.tsx`, used in `agent-blocks.tsx` `product_cards`, `model_shortlist`)

```
+----------------------------------------------+
| +------+  [ارزان‌ترین]                         |  reason badge on top
| | img  |  هدفون بی‌سیم شیائومی مدل Buds 6...  |  14/700, 2 lines
| | 72²  |  از ۳٫۳۴۰٫۰۰۰ تومان                  |  14/700
| +------+  در ۸ فروشگاه                        |  12 muted
|           دیدن فروشنده‌ها ‹          ☑ مقایسه |  blue text link (primary) | compare toggle
+----------------------------------------------+
```

- The `<details>` "چرا این؟" goes. Its match words become the reason badge (section 5).
- `ListedPrice` becomes one line: `fromToman(min)`, or "قیمت: نامشخص". The price age is not shown on
  product cards (it differs per seller). Price flags stay as one muted 12 px note line.
- shadcn: `Card`, `Badge`. The image sits in a white 72 px well with radius 8 and `object-contain`.

### FilterChipBar and filter sheet (replaces `brief-bar.tsx`)

```
| [≡ فیلترها ②] [نزدیک من، ۱ کیلومتر ⌄] [الان باز ×] [بودجه ⌄] [ترب‌پی حضوری] [اقساطی] [گارانتی] →
```

- White bar, 52 px, sticky under the app bar, scrolls sideways in its own row. Chips 36 px,
  `rounded-full`, 1px `--border`; pressed = 1.5px ink border, 700.
- One-tap toggles: الان باز -> `visit_window {date: today, earliest_arrival: now}` (sends `arrival`);
  ترب‌پی حضوری -> `payment.kind=torob_pay`; اقساطی -> `payment.kind=installment`; گارانتی ->
  `must_have.warranty`. No rating anywhere.
- محدوده, بودجه and فیلترها open a `Drawer` (bottom sheet, handle, dimmed page). Area: "نزدیک من" with
  radius chips (500 m, 1/2/5 km), then session areas and pasajs. Budget: presets (۲/۵/۱۰/۲۰ میلیون)
  and a number field. فیلترها: everything, plus visit time, travel mode, priority, test in presence;
  its badge counts active filters.
- Shown on the sellers route and the home hero, not in the global layout. A filter left by an old
  session shows as a pressed chip, one tap from cleared (the audit's stale-brief case).
- shadcn: `Drawer`, `ToggleGroup`/`Toggle` (`variant="outline"`), `Button`, `Input`, `ScrollArea`.

### List/map toggle (`seller-list.tsx` head, `seller-map.tsx`)

```
| ۶ فروشنده · ارزان‌ترین ⌄              [≡ فهرست | ▱ نقشه] |
```

- A segmented `ToggleGroup` (32 px, ink fill when on). The sort opens a small `Drawer` (ارزان‌ترین /
  نزدیک‌ترین / معتبرترین, mapped to `brief.priority`).
- Map view, the Google Maps pattern: the map fills the space under the chip bar, and a horizontal row
  of compact ResultCards is docked over its lower edge. Tapping a pin scrolls that row to the shop, and
  swiping the row moves the selected pin. The list is never hidden behind a second tap.

### Agent drawer: message with cards and suggestion chips (`agent-sheet.tsx`, `agent-blocks.tsx`)

```
|            ‾‾‾‾                               |  Drawer, snap points 0.9 / closed, handle
| دستیار خرید                                ×  |
| [تا ۵٫۰۰۰٫۰۰۰ تومان ⌄] [پاساژ علاءالدین ⌄] → |  brief chips: what the agent understood
|            [هندزفری بلوتوثی ... علاءالدین]    |  user bubble: ink fill, white text
| ۲ مدل با فروشنده در علاءالدین زیر ۵ میلیون پیدا شد. |  one sentence of prose at most
| [ProductCard] [ProductCard]                   |
| [مقایسه این دو] [فقط فروشگاه‌های باز] [با گارانتی] |  suggestion chips: white, 1px border, r8
| (tool running) ◌ در حال مقایسه ۲ مدل           |  skeleton rows: flat grey bars at real sizes
| [ بپرسید یا شرط اضافه کنید      ] [↑ red]     |  composer, 40 px
```

- No auto-open: only a tap opens it (agent bar, home entry, chip, starter tile); a restored thread
  waits. Closed state: a 56 px bottom bar on home, an icon button beside the route's CTA elsewhere.
- Every turn ends with a block or chips. `useRenderTool` per backend tool (`search_products`,
  `find_sellers`, `compare_products`, `compare_sellers`, `suggest_models`, `plan_visit`,
  `contact_seller`, ...), drawn via `useRenderToolCall` in the hand-written thread: `inProgress` /
  `executing` show "در حال ..." and a skeleton of the final block; `complete` shows the `BLOCKS` renderer.
- `useConfigureSuggestions` static `{title, message}[]` keyed by the last block kind, read with
  `useSuggestions`: after `product_cards` مقایسه این دو، فقط فروشگاه‌های باز، با گارانتی، ارزان‌تر;
  after `seller_list` استعلام از ۳ ارزان‌تر، نزدیک‌ترین، فقط ترب‌پی; before the first message the
  home starters.
- shadcn: `Drawer`, `Button`, `Input`, `Skeleton`, `ScrollArea`, `Badge`.

### Home entry (`home-start.tsx`, `app/page.tsx`)

```
| [پ] پاساژگرد                               ⟲  |  app bar, red mark
| چه چیزی می‌خواهید حضوری بخرید؟                  |  16/700
| [ مثلا هندزفری بلوتوثی برای ورزش    ] [🔍 red] |  grey field 48 px, the screen's CTA
| [نزدیک من] [الان باز] [بودجه ⌄] [ترب‌پی حضوری] → | condition chips (same FilterChipBar)
| (⟲) هندزفری بلوتوثی زیر ۵ میلیون       ادامه |  resume card (RecentSessions, newest one)
| از یک دسته شروع کنید                          |
| [هدفون و هندزفری] [کیف و کاور گوشی]           |  2-col tiles, 56 px, white r16
| [تاچ و ال‌سی‌دی گوشی] [ساعت مچی] ...          |
| پاساژها                          همه مناطق    |  list rows to /pasajs/[pasaj]
| داده‌ها بخشی از فروشگاه‌های تهران ... (white)  |  coverage note
| [ کمکم کن انتخاب کنم ]                         |  agent bar (HELP_CHOOSE)
```

- Category tiles: a constant list hand-picked from the dataset's top `category_name` values; a tap
  opens the drawer and sends a starter ("هدفون و هندزفری می‌خواهم"). No counts (no endpoint).
- Condition chips patch the brief before the first message. Pasaj rows: first 3 of `session.pasajs`;
  "همه مناطق" opens the area sheet.
- shadcn: `Input`, `Button`, `Card`, `Toggle`, `Drawer` (reused from the FilterChipBar).

## 5. Reason badge rules (`web/lib/reasons.ts`)

A result shows one badge, the first match in priority order. The brief's `priority` moves its own
reason to the front: `cheapest`, `closest`, or `most_reliable`, which uses the order as written. A
reason that every visible row shares is skipped (all rows are open when "الان باز" is on). Confirmed
stock is not a reason: it has its own slot.

Seller row, from `SellerRow.reasons` (backend `_add_reasons`), then local data:

| # | Source | Label |
|---|---|---|
| 1 | reason `cheapest` | ارزان‌ترین |
| 2 | reason `closest` | نزدیک‌ترین |
| 3 | reason `open_now` | الان باز |
| 4 | reason `installments` and brief payment is torob_pay/installment | provider name, e.g. ترب‌پی حضوری |
| 5 | reason `warranty` | گارانتی ۱۸ ماهه |
| 6 | reason `fresh_price` | قیمت این هفته |
| 7 | reason `declared_hours` | ساعت کاری مشخص |
| 8 | `pasaj` set | the pasaj name, e.g. پاساژ علاءالدین |
| 9 | otherwise | فروشنده این کالا |

Product card, comparing the cards in one block:

| # | Source | Label |
|---|---|---|
| 1 | lowest `price.min_toman` among at least 2 priced cards | ارزان‌ترین |
| 2 | highest `offer_count`, at least 2 cards and 3 offers | بیشترین فروشنده |
| 3 | `price.price_age_bucket == "<=7"` | قیمت این هفته |
| 4 | every `score_parts.matched` | مطابق جستجو |
| 5 | `meaning_match` | هم‌معنا با جستجو |
| 6 | otherwise | `در N فروشگاه` |

The badge is ink on `--muted`, `rounded-full`, 12/700, and never coloured.

## 6. Next-action rules

Each result has one filled action. The rest are ghost or text. Red appears once per screen.

| Where | State | Primary | Secondary |
|---|---|---|---|
| Seller row | no inquiry | استعلام بگیرید (contact) | مسیر (ghost), مقایسه (check) |
| Seller row | inquiry sent | disabled "استعلام فرستاده شد، ۱۱:۳۰" | مسیر |
| Seller row | available yes | مسیر تا فروشگاه (contact) | مقایسه |
| Seller row | no / no_reply / closed | جایگزین‌ها (outline) | مسیر |
| Seller row | price null | استعلام بگیرید | مسیر |
| Product card | any | دیدن فروشنده‌ها (blue text link, whole card tappable) | مقایسه |
| Product card | basket mode | افزودن به سبد (outline) | دیدن فروشنده‌ها |
| Sellers screen | dock | استعلام از N فروشنده ارزان‌تر (buy, red) | agent icon |
| Sellers screen | dock, 2-3 checked | مقایسه N فروشنده (red) | agent icon |
| Home | hero | search submit (red square) | agent bar |
| Agent drawer | composer | send (red square) | suggestion chips |

## 7. Issues (proposed split)

Every e2e runs at the config's 360x740 viewport with mocked routes (`fake-session.ts`) and also
asserts `document.documentElement.scrollWidth <= 360`.

### A. Theme tokens, format helpers, reason rules, shadcn primitives (first; blocks B-E)
- Files: `web/app/globals.css`, `web/lib/format.ts`, new `web/lib/reasons.ts` + `reasons.test.ts`,
  `web/components/ui/{card,button}.tsx` and new `drawer toggle-group toggle skeleton scroll-area` (shadcn
  add), "نامشخص" swaps in the files no other issue touches (`shop-details.tsx`, `seller-compare.tsx`,
  `inquiry-tracker.tsx`, `visit-plan.tsx`, `pasaj-view.tsx`), new `web/e2e/theme.spec.ts`.
- AC (e2e at 360 unless noted):
  1. `body` is `rgb(241, 245, 249)` with `rgb(30, 41, 59)` text; a `Card` is white, no shadow, 16 px
     radius (computed styles on `/`).
  2. Prices render with U+066B: `۳٫۵۰۰٫۰۰۰ تومان` on the sellers fixture.
  3. The shop page with null fixtures shows "نامشخص" in `rgb(100, 116, 139)` and no "ثبت نشده".
  4. On `/plan` the map-app deep links use `contact-outline` (`#3468cc` text and border) and the
     share button uses `buy` (`#d73948` fill), checked by computed style.
  5. `node --test web/lib/reasons.test.ts` (Node type stripping; `reasons.ts` has no `@/` imports)
     covers each row of section 5, the priority reorder and the shared-reason skip.

### B. ResultCard, list/map toggle, sellers dock
- Files: `web/components/seller-list.tsx`, `web/components/seller-map.tsx`, `web/e2e/sellers.spec.ts`,
  `web/e2e/map.spec.ts`.
- AC (e2e at 360):
  1. Each row has `data-slot="price"`, `"age"` and `"availability"` as three labelled elements, for a
     listed, a confirmed and a null-price fixture; the null one reads "قیمت: نامشخص".
  2. Availability reads "موجود است" only with `inquiry.available="yes"`; else "نامشخص" or the inquiry
     state. The age slot never contains "به‌روز".
  3. Each row has exactly one reason badge per section 5 (cheapest+warranty fixture shows "ارزان‌ترین").
  4. Each row has exactly one filled button per section 6; the page has exactly one `bg-brand` button
     (the dock).
  5. The list/map toggle switches views; in map view a pin tap scrolls the docked card row so that
     shop's card is fully visible.

### C. FilterChipBar and filter sheets
- Files: `web/components/brief-bar.tsx` (rewritten as FilterChipBar + sheets), `web/app/layout.tsx`
  (bar out of the global shell), `web/app/products/[productId]/sellers/page.tsx`, `web/e2e/brief.spec.ts`.
- AC (e2e at 360):
  1. Tapping "الان باز" sends a sellers request with `arrival` set to the current time.
  2. "ترب‌پی حضوری", "اقساطی", "گارانتی" patch `payment.kind` / `must_have.warranty`; pressed chips
     have a 1.5px ink border.
  3. "محدوده" and "بودجه" open a bottom drawer; a preset closes it and the chip shows the value.
  4. "فیلترها" shows the active count; no rating control exists.
  5. The chip row scrolls inside itself (no page overflow) and the first seller row starts in the top
     60% of the 360x740 screen.

### D. ProductCard and home entry (after C: home uses the chip bar)
- Files: `web/components/product-card.tsx`, `web/components/home-start.tsx`, `web/app/page.tsx`,
  `web/e2e/home.spec.ts`.
- AC (e2e at 360):
  1. Home shows the search field, condition chips, at least 4 category tiles and the pasaj list; a tile
     tap sends its starter to the fake agent.
  2. A condition chip on home patches the brief before any message.
  3. A product card shows one reason badge, `از ... تومان`, `در N فروشگاه` and "دیدن فروشنده‌ها"; no
     `<details>`.
  4. A multi-line paste still goes to `/basket`.

### E. Agent drawer, suggestions, tool skeletons
- Files: `web/components/agent-sheet.tsx`, `web/components/agent-blocks.tsx`, `web/e2e/agent.spec.ts`,
  `web/e2e/fake-agent.mjs` (a slow tool event).
- AC (e2e at 360):
  1. With a stored thread, `/products/x/sellers` loads with the drawer closed; a tap on the agent bar
     opens it.
  2. While the fake `find_sellers` call runs, a skeleton with "در حال یافتن فروشنده‌ها" shows; the seller
     block replaces it on completion.
  3. After a `product_cards` block at least 3 suggestion chips show; a tap sends its message.
  4. The drawer has a drag handle, closes by swipe or the close button, and leaves the app bar visible.

Order: A first; then B, C, E in parallel (file-disjoint); D after C.

Skipped on purpose: dark theme; a product search route; restyling shop/plan/compare beyond tokens;
Torob Pay purple; "باز تا HH:MM" on seller rows (needs a closing time on `SellerRow`, a backend change).
