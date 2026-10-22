# Current UI audit (before the UI/UX overhaul)

Snapshot of `main` at 9dee144, 2026-10-22. Facts only; file:line refs are to that commit.
Screenshots at 360 px: `docs/design/current/` (section F).

## A. Routes, components and flow

Shell (`web/app/layout.tsx:19-31`): `<html dir="rtl">`, then `BriefProvider` > `BriefBar` (sticky top) >
`CompareTrayProvider` > page > `AgentSheet` (fixed bottom). Every route gets the brief bar and the agent sheet.
Each page file is a 15-line wrapper: `<main max-w-xl>` + `Suspense` + one client component.

| Route | Shows | Main component(s) |
|---|---|---|
| `/` | title, one-sentence input, 3 example buttons, "کمکم کن انتخاب کنم", "نزدیک من", recent sessions | `home-start.tsx` `AgentStart` :24, `HelpChoose` :71, `NearMe` :79, `RecentSessions` :107 |
| (sheet, all routes) | chat thread: user bubbles, assistant text, tool results as blocks; input + send | `agent-sheet.tsx` :20-129, `agent-blocks.tsx` `BLOCKS` :103 |
| `/products/[productId]/sellers` | title, count, list/map toggle, seller cards, "از فروشنده بپرسید" group, category-only shops, inquiry tracker, sticky "مقایسه فروشنده‌ها" | `seller-list.tsx` `SellerList` :159, `Seller` card :111, `seller-map.tsx` |
| `/products/[productId]/sellers/compare?offer=` | seller compare table (price, trust, hours at arrival, payment, delivery) | `seller-compare.tsx` :174 |
| `/compare?ids=` | product compare table (price range, sellers, warranty, spec diff) | `product-compare.tsx` :53 |
| `/shops/[shopId]` | name, address; tables: location, hours this week, payment & delivery, links | `shop-details.tsx` :47, sections :71, :92, :111 |
| `/pasajs/[pasaj]?product=` | shops of one pasaj grouped by floor, with the item's price | `pasaj-view.tsx` :38 |
| `/plan?shop_id=&lat=&lon=&mode=&depart_at=` | visit plan: map + ordered stops, ETA, open at ETA, nudges, deep links | `visit-plan.tsx` :176, map :197 |
| `/basket?text=` | multi-line list -> fewest-shop basket | `basket.tsx` |
| `/console/[shopId]?token=` | demo Seller Console (seller side) | `seller-console.tsx` |

There is no search-results route and no product page: product cards exist only inside the sheet
(`agent-blocks.tsx:104`). Backend `GET /products/{id}` (`backend/src/pasazhgard/api.py:212`) has no web route.

Flow:

```
/  --input/example/HELP_CHOOSE--> window event AGENT_SEND (home-start.tsx:21) --> AgentSheet.send (agent-sheet.tsx:63)
   sheet blocks: product_cards / model_shortlist --link--> /products/:id/sellers
                 compare_table --> /compare ; seller_compare --> /products/:id/sellers/compare
                 visit_plan --> /plan ; basket (inline) ; inquiry_status (inline tracker)
/  --multi-line paste--> /basket (home-start.tsx:42-47)
/products/:id/sellers --shop name--> /shops/:id ; --map pin--> /pasajs/:pasaj ; --compare 2-3--> .../sellers/compare
.../sellers/compare --plan link--> /plan
```

Brief state: `brief-provider.tsx` keeps one server session per browser (localStorage, :13-39); the brief bar chips
patch it and the sellers list re-filters on the server (`seller-list.tsx:199-205`). Note: a stale brief follows the
user everywhere (screenshot `sellers.png`: area + 2M budget from an old session leaves 0 sellers).

## B. Data availability (backend code, API and dataset)

Dataset: `dataset/*.csv` (full: shops 6,476, products 225,903, offers 331,506; columns in `dataset/README.txt`),
fixture `backend/tests/fixtures/dataset/` has the same columns. Types mirrored in `web/lib/api.ts`.

| Field | Status | Where (dataset -> API field -> endpoint) |
|---|---|---|
| Price | **exists** (95.4% of offers) | `offers.price_toman` -> `SellerRow.price_toman` (`GET /products/{id}/sellers`); product range `ProductCard.price.min_toman/max_toman` (`GET /products/search`, `/products/compare`, agent blocks). Flags `missing/placeholder/invalid/per_meter/far_from_median` (`api.ts:4`). |
| Price last-update time | **exists, but it is last *change*** | `offers.last_price_changed_at` (330,737 non-null) -> `PriceRange.last_price_changed_at`, `price_age_days`, `price_age_bucket` (`api.ts:11-13`); `SellerRow.price_age_days/bucket` (`api.ts:111-112`). PRD 8 forbids labelling it "به‌روز شده". There is no "last checked" time. |
| Confirmed availability | **partial: only after an inquiry** | Nothing in the dataset. `Outcome.available` yes/no/unknown + `replied_at` (`api.ts:345-354`) on `SellerRow.inquiry`; `LatestPrice{status: not_asked/asked/website/confirmed, at}` on `SellerRow.latest_price` (`api.ts:338-343`); live via `GET /sessions/{id}/inquiries/stream`. Website price (`POST /sessions/{id}/site-prices`) is price only, never stock. Listed != available. |
| Opening hours | **exists** (~69% of shops, PRD 10.1) | `shops.weekly_hours` -> `ShopDetails.hours.week[]` status `declared/closed/unsupported/unknown` + shifts (`GET /shops/{id}`) |
| Open now | **exists (computed), no filter** | `SellerRow.open_now: bool or null` from `open_at()` (`backend/src/pasazhgard/shops.py:53`, `sellers.py:166`); also `Alternative.open_now`, `Stop.open_at_eta`, `SellerColumn.open_at_arrival`. The only hours filter is `arrival` (from brief `visit_window.earliest_arrival`, `brief.py:175-187`): failing shops dropped, unknown -> `ask_them` (`sellers.py:177-178`). No `open_now` query param. Not on product cards. |
| Distance from user | **partial: only with an origin** | Computed great-circle from `brief.origin` (`sellers.py:127-136`) -> `SellerRow.distance_m`, `CategoryShop.distance_m`; null without origin. Route time only via `GET /shops/{id}/directions` (Neshan, else straight line; `maps:false` on the local stack). Not on product cards. |
| Area / pasaj | **exists** | `shops.location_label` -> `SellerRow.area`; pasaj/floor/unit parsed from address at ingest -> `SellerRow.pasaj/floor/unit`, `ShopDetails`; option lists `SellerList.areas/pasajs`, `Session.areas/pasajs/centers`; filters `area`, `pasaj`, `radius_m` (`sellers.py:17-21`). |
| Torob Pay | **partial (sparse)** | `shops.payment_options[].provider_name` = "ترب‌پی": 190 shops (50 `in_person`, 140 `unknown`). -> `SellerRow.payment_options[{provider, channel}]`. Filter `payment=torob_pay` passes only `in_person` (`sellers.py:182-183`); everything else goes to `ask_them`. |
| Installments | **partial (sparse)** | Same `payment_options` list: 266 shops (4%) declare any provider (ترب‌پی 190, اسنپ‌پی 89, دیجی پی 61, تارا 37, ازکی‌وام 5). Filter `payment=installment&provider=` (`sellers.py:180-181`). Seller's answer `Outcome.installments` overrides (`sellers.py:186-187`). min/max price fields are all empty and dropped (`clean.py:209-211`). |
| Warranty | **partial** (18% of offers) | `offers.warranty` JSON -> `SellerRow.warranty{kind: warranty/test_in_presence/none, provider, months, description}`; product level `CompareColumn.warranty{sellers, max_months}`. Filter `warranty`, `test_in_presence` (term required, `sellers.py:189-193`). |
| Fast delivery | partial | `shops.supports_fast_delivery` (1,168 yes / 433 no / 4,875 unknown) -> `ShopDetails.fast_delivery`, `SellerColumn.fast_delivery`; filter `fast_delivery`. Not on `SellerRow`. |
| Rating | **absent** | No column in any CSV, no field in any model. A rating/"top rated" chip would be fabricated. `most_reliable` priority is a data-completeness score (fresh price + warranty term + declared hours, `sellers.py:210-212`), not a rating. |

Filters that can be real today: area / pasaj / radius, budget, open at arrival time (via visit time), Torob Pay,
installments (+ provider), warranty, test in presence, fast delivery, priority (cheapest / closest / most_reliable).
"Open now" as a one-tap filter needs `arrival=now` (the param exists) rather than new data.

## C. Agent and CopilotKit usage

- Runtime: `web/app/api/copilotkit/route.ts:6-10`, `CopilotRuntime` (`@copilotkit/runtime/v2`) with one
  `HttpAgent` named `pasazhgard` -> FastAPI `/agent` (AG-UI from `ag_ui_langgraph`, `backend/src/pasazhgard/api.py:75`).
- Client: `agent-sheet.tsx:25` `CopilotKitProvider` + `useAgent` + `useCopilotKit().runAgent` (:32-33, :69). The chat UI
  is hand-written (Input + Button + `<p>` bubbles, :82-127). No `CopilotChat`, `CopilotPopup` or `CopilotSidebar`.
- Blocks: the backend tool returns `{"block": kind, ...}` JSON (`agent.py:97-100`); the sheet renders every
  `role: "tool"` message through `Block` (`agent-sheet.tsx:96`, `agent-blocks.tsx:199-209`), which parses JSON and looks up
  `BLOCKS` (:103). Renders appear only after the tool finishes; there is no in-progress state per tool.
- Block types (`agent.py:153-345`, renderers `agent-blocks.tsx:104-196`): `product_cards` (top 5 `ProductCard`),
  `model_shortlist` (`Pick` card with trade-offs), `seller_list` (top 3 `Seller` cards + link), `compare_table` (titles +
  link only), `seller_compare` (shop names + link only), `inquiry_status` (live `InquiryTracker`), `visit_plan` (stop
  list + link), `directions`, `alternatives`, `basket`, `chips`.
- Suggestion chips: only the `chips` block from the `ask_user` tool (`agent.py:251-301`), answers to a brief question;
  a chip tap sends its text as a new user message (`agent-blocks.tsx:185-196`). A question written in prose is forced
  into `ask_user` (`agent.py:398-411`). There are no next-step chips after results (e.g. "ارزان‌ترین را نشان بده",
  "نزدیک من"). The empty sheet shows one fixed button, `HELP_CHOOSE` (`agent-sheet.tsx:104-108`).
- Assistant prose is plain `<p>` (`agent-sheet.tsx:92-95`); a turn can end in prose with no block (seen in
  `agent-sheet.png`: "در محدوده شیخ هادی گزینه‌ای در بودجه پیدا نشد." with no card or next action).
- Thread restore: `GET /sessions/{id}/messages` (`agent-sheet.tsx:47-61`); the sheet opens itself when a thread exists
  (:52), covering up to 65dvh on every route.
- Consent for inquiries goes through REST (`confirmInquiries`), not CopilotKit HITL (ADR-0002 amendments).

CopilotKit 1.77.2 exports not used (from `node_modules/@copilotkit/react-core/dist/v2/index.d.mts`, `headless.d.mts`):

| Export | What it would give |
|---|---|
| `useConfigureSuggestions` (`headless.d.mts:604`), `useSuggestions` (:594), `CopilotChatSuggestionView`, `CopilotChatSuggestionPill` | Suggestion pills. Static config (`StaticSuggestionsConfig`: `{title, message}[]`, `available: before-first-message / after-first-message / always`) costs nothing; `DynamicSuggestionsConfig{instructions, minSuggestions, maxSuggestions, providerAgentId}` (`@copilotkit/core` dist `index.d.mts:160`) runs an LLM call. |
| `useRenderTool` (:869/:901), `defineToolCallRenderer`, `useRenderToolCall`, `useDefaultRenderTool` | Per-tool renderers with `inProgress / executing / complete` status, so a block can show a skeleton while the tool runs instead of "در حال فکر کردن...". Today's `BLOCKS` map is a manual version of this. |
| `useAgentContext` (:623) | Send page context (current product, visible sellers) to the agent each run. |
| `useFrontendTool(s)`, `useHumanInTheLoop`, `useInterrupt` | Client tools / approval UI; consent currently bypasses these on purpose (ADR-0002). |
| `CopilotChat`, `CopilotChatView`, `CopilotChatInput`, `CopilotPopup`, `CopilotSidebar` | Prebuilt chat; would need RTL/shadcn restyling. |
| `useThreads` | Thread list; home's "recent sessions" is hand-built from localStorage. |

Dev-only: the CopilotKit inspector button and its "New AG-UI 1.0" popover render over the page in `next dev`
(top-right in the screenshots); not set off anywhere in `web/`.

## D. shadcn

- `web/components.json`: `style: "base-nova"` (Base UI primitives, `@base-ui/react` 1.9.0), `baseColor: neutral`,
  `rtl: true`, `iconLibrary: lucide`, no extra registries.
- Installed in `web/components/ui/`: `badge`, `button`, `card`, `input` only.
- Theme `web/app/globals.css:51-80`: stock neutral oklch tokens (`--primary: oklch(0.205 0 0)`, black), `--radius 0.625rem`,
  font Vazirmatn Variable (:10). No brand color.
- Hand-rolled stand-ins: toggle groups are `Button` rows with `aria-pressed` (`brief-bar.tsx:50-60` `Choices`), the
  sheet is a fixed `<section>` (`agent-sheet.tsx:83`), the "why" panel is `<details>` (`product-card.tsx:87`), brief-bar
  editors are inline panels, list/map uses `Choices` (`seller-list.tsx:233`), loading is a text line.

Needed for the overhaul (verified with `pnpm exec shadcn view`; the base-nova registry serves Base UI versions, and
`@base-ui/react` 1.9.0 already ships `drawer`, `tabs`, `toggle-group`):

```bash
cd web && pnpm dlx shadcn@latest add drawer sheet toggle-group toggle tabs skeleton tooltip separator scroll-area
```

`drawer` imports `@base-ui/react/drawer` (snap points, swipe handle), not vaul. `toggle-group` depends on `toggle`
(the CLI pulls it). Badge already exists for chips; `toggle-group` with `variant="outline"` fits filter chips.

## E. Gaps against the overhaul goals

1. **Look like Torob**
   - Stock neutral black/white theme, no brand color, no logo (`globals.css:51-80`; `app/page.tsx:7` plain `<h1>`).
   - Price is `text-sm font-bold`, same size as the shop name (`seller-list.tsx:118-122`, `product-card.tsx:45`);
     no large price line like Torob cards.
   - Product card image is 80 px beside text (`product-card.tsx:65-70`); no grid of product tiles.
   - Price format is `faDigits(n) تومان` (`format.ts:3-7`): correct Persian digits and separators already.
2. **Maps / Snapp / Perplexity patterns**
   - List/map toggle exists (`seller-list.tsx:233`) but as two buttons, and the map view hides the list (:267).
   - No "open now" filter chip (data in B: `arrival` param); `open_now` shows only as a reason badge (`seller-list.tsx:50`).
   - Distance shown only inside the place text line (`seller-list.tsx:63-71`) and only with an origin.
   - Brief-bar editors are inline panels under a sticky bar (`brief-bar.tsx:125-272`), not bottom sheets.
   - Agent sheet is a fixed footer with a scrolling div (`agent-sheet.tsx:83-102`): no drag handle, snap points or
     backdrop; it auto-opens on any route with a thread (:52).
   - Chat answers can be text only (section C); no next-step suggestion chips after results.
3. **Chat is not the only way in**
   - Home has one free-text input plus examples (`home-start.tsx:24-65`); there are no category cards and no direct
     buttons for area, budget, Torob Pay, installments or open now on home. Those live only in the brief bar.
   - No product search page: typed search goes only to the agent (`home-start.tsx:34`), so with the model slow or down
     the user waits (screenshot: the turn ran > 70 s). `GET /products/search` exists (`api.ts:32`, unused by any route).
   - CopilotKit used as a transport only (section C).
4. **Every result says why and what next**
   - Seller cards: reasons exist as outline badges (`seller-list.tsx:145-153`, backend `_add_reasons` `sellers.py:228`)
     but look like every other badge, and Torob Pay / any provider is labelled "اقساط ..." (`seller-list.tsx:52-53`, :141).
   - Product cards: the "why" is hidden behind `<details>` "چرا این؟" (`product-card.tsx:87-104`) and explains word
     matches, not "closest / cheapest / open now".
   - `compare_table` and `seller_compare` blocks render only names + a link (`agent-blocks.tsx:142-160`).
   - Next actions are text links (`linkClass`, `agent-blocks.tsx:74`) of equal weight; seller card has three equal
     buttons (`seller-list.tsx:186-195`).
5. **Price, update time, availability separate; "نامشخص" for missing**
   - Seller card mixes listed price, trust badge and age on two lines (`seller-list.tsx:118-138`); the seller-confirmed
     price (`SellerRow.latest_price`) is **not shown on the card at all**, only in the seller-compare table
     (`seller-compare.tsx:104-113`) and inquiry tracker (`inquiry-tracker.tsx:60-62`).
   - Availability has no slot on any card; "listed" is the only signal (`Badge "قیمت ثبت‌شده"`).
   - Missing values use several wordings: "ثبت نشده", "قیمت ثبت نشده", "ساعت کاری ثبت نشده", "مکان ثبت نشده",
     "نحوه پرداخت نامشخص", "موجودی نامشخص" (`grep -n "ثبت نشده\|نامشخص" web/components`). PRD 8 table says
     Unknown = "ثبت نشده"; the goal says "نامشخص". Pick one and put it in one helper (`shop-details.tsx:23`
     `NotRecorded` is the closest existing one).
   - `open_now === null` (hours unknown) shows nothing on the seller card, only a missing badge.

## F. Screenshots (360 px, `next dev` on :3000, Docker `app` + `db` with the full dataset, `llm: true`, `maps: false`)

- `docs/design/current/home.png` (full page)
- `docs/design/current/agent-sheet.png`: home after tapping an example. The browser's old session thread reopened;
  the new turn was still "در حال فکر کردن..." after ~70 s.
- `docs/design/current/sellers.png` (full page): `/products/product_000d4eb91c222937766ff305/sellers` (7 sellers in
  the API without filters). The stale brief (area شیخ هادی, budget 2M) left 0 sellers and only category-only shops;
  the auto-opened sheet covers the lower half.
- `docs/design/current/shop.png` (full page): `/shops/shop_9cee4549095d471a897919a1`, also under the sheet.

All four show the CopilotKit dev inspector and the Next.js dev badge; a production build would not.
Not captured: a seller list with a fresh brief, the map view, plan and compare pages.
