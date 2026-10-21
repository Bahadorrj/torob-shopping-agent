# PRD: In-Store Shopping Agent for Tehran (working name: پاساژگرد / Pasazhgard)

| | |
|---|---|
| Status | Draft v2 |
| Context | Torob hackathon entry (section 1.1); dataset in `dataset/` |
| Date | 2026-10-21 |

## 1. Summary

Pasazhgard is an AI shopping agent for people who want to buy in person from shops, pasajs and malls in
Tehran. The user says what they need in plain Persian, even if they do not know which model they want.
The agent helps them pick a model, compares products, finds sellers that fit their budget, location and
payment needs, and compares those sellers. It then contacts the sellers for the latest price and stock,
falls back to other sellers when one does not answer or is closed, and guides the user from where they
are to the right pasaj, floor and unit.

The agent is the product, not a chat box on top of a search page. It holds the user's shopping goal as
state, calls typed tools over the Torob dataset and over the sellers themselves, acts on the user's
behalf, and keeps working after the first answer. The UI is mobile-first, Persian and RTL, and built
around cards, chips and buttons so the user rarely has to type twice.

### 1.1 Challenge context

**Task.** Torob's hackathon asks for an intelligent assistant for in-person shopping at small and large
shops, pasajs and malls in Tehran, built on Torob's dataset of Tehran shops and products. Teams may add
features of their own. The organizers define the assistant's four steps (section 5) and its pain points
(section 2).

**Organizer requirements.**

- UX: not every flow has to go through chat. Cards, filters and buttons should let the user move forward
  without asking again. Search and comparison results must show why a product or shop is suggested and
  what the next step is. The user must be able to change area, budget and purchase conditions easily and
  see the result.
- Transparency: do not treat listed price, price-change time and confirmed stock as the same thing. Show
  unknown information clearly. A shop's activity category alone does not mean it has a product.
- Persian, RTL and mobile first.
- Product and UX come first; scalable engineering comes second.

**Deliverables.**

- Demo video of about 5 minutes, mandatory: entries without one are dropped. Video quality counts.
  Show and explain the working product, not source code. Narration scores higher than a silent
  recording; no special editing needed.
- The project deployed and running on a server (judged, see rubric).

**Dataset notes from the organizers.**

- Offers say which shop offers which product, at what price, and when the price last changed; data is
  from the week before release.
- 6,364 of 6,476 shop names are fake; all phone numbers are fake; other fields such as location are
  real. The 112 real names are the shops with an Instagram page (22) or website (90).
- All shops are in Tehran, but only about 10% of Tehran's shops are on Torob, selected from some areas.
- Each shop is capped at 300 products: 225,903 unique products and 331,506 offers.
- Which contact fields may be published will be decided in the final dataset version.

**Judging rubric (300 points).**

| Criterion | Points | What judges look for |
|---|---|---|
| Product | 75 | Does it really solve in-person shopping and cover product search, comparing options, finding sellers in the chosen area, following up with sellers? |
| UX | 75 | Can users work with the agent easily; is the UI simple, smooth and friendly? |
| Intelligence | 50 | Does the agent complete the purchase: following up with sellers, suggesting alternatives when out of stock, accounting for visit conditions (time, location, need)? |
| Deployment | 40 | Quality and stability of deploying and running the project on a server |
| Technical | 40 | Code structure, fitting tools and technologies, performance and scalability, difficulty |
| Dataset | 20 | Products and shops data used correctly and shown transparently |

## 2. Problem

Pain points named by the organizers, and how the agent answers each:

| # | Pain point | What the agent does | Requirements |
|---|---|---|---|
| P1 | The user does not know which specific model they want | Asks a few chip questions about use and must-haves, then shortlists 2-3 models with plain trade-offs and nearby prices | U3, U4, S3 |
| P2 | Registered prices may be outdated | Treats listed prices as a starting point and uses tools to get the latest price from sellers (message the seller; read the seller's website where one exists) | F1, F4, F11 |
| P3 | The seller may not answer, or the shop is closed | Checks hours before contacting, times out unanswered inquiries, and offers ranked alternative sellers right away | L2, F5, F6, F7 |
| P4 | The shop is hard to find, often inside a mall or pasaj | Route from the user's current location to the pasaj, then pasaj name, entrance landmark, floor and unit | F8, F9 |
| P5 | The user wants extra filters, e.g. shops that offer installments | Filters for installment provider, Torob Pay in person, warranty, open at arrival time, fast delivery; unknowns shown, not hidden | L3 |

The transparency requirements in 1.1 cut across all of these (section 8).

## 3. Goals and non-goals

### Goals

1. Cover the four steps end to end (section 5) and every pain point above.
2. Make the agent's work visible and trustworthy: every recommendation says why, and every fact says how
   sure we are (listed vs fetched vs confirmed, how old, unknown).
3. Mobile, Persian, RTL first. A user can finish a task with taps after one sentence of input.
4. Ship a stable public deployment and a 5-minute demo video.

### Non-goals (for the hackathon)

- Online checkout or payment.
- Real calls or messages to real shops (all contact numbers in the dataset are fake; messaging is
  simulated, see 6.4). Reading public seller websites is in scope.
- Indoor maps of pasajs (the dataset has floor and unit text, not floor plans).
- Coverage beyond the dataset (about 10% of Tehran shops, from selected areas).
- User accounts, seller onboarding, live inventory integration.
- Scale engineering beyond what the dataset needs (product and UX come first, see 1.1).

## 4. Users and scenarios

| Persona | Need | What decides success |
|---|---|---|
| **Unsure buyer** | Knows the need ("هندزفری برای باشگاه"), not the model | A model they understand and trust, then a seller |
| **Model-known buyer** | Wants to see and test before buying, at a fair price | Latest price confirmed, no wasted trip |
| **Installment buyer** | Must pay by installment or Torob Pay in person | Only shops that meet the condition, unknowns shown honestly |
| **Urgent buyer** | Needs it today near work | Open now, close by, seller answered |
| **Basket buyer** (P1) | A list of parts, e.g. an electrician | Fewest stops that cover the list |

### Anchor scenarios (used for the demo and the eval set)

Grounded in the dataset: the products below have many sellers in the downtown cluster.

- **A. Unsure buyer, full journey.** "یه هندزفری بلوتوثی برای باشگاه می‌خوام، نمی‌دونم کدوم مدل.
  امروز عصر میرم جمهوری، قسطی هم باشه بهتره." The agent asks two chip questions (budget; in-ear vs
  over-ear), shortlists three models (e.g. Anker Soundcore R50i, 44 offers in the dataset), compares
  them, filters sellers near Jomhouri open at 17:00 with installments, and compares three sellers. It
  asks them for the latest price: one confirms a new price, one does not answer, one is closed. The agent
  swaps in an open seller in the same pasaj and shows the route from the user's location to the pasaj,
  floor and unit.
- **B. Basket (P1).** "سیم افشان ۲.۵ خراسان ۲ حلقه، محافظ برق ۱۶ آمپر، کلید مینیاتوری ۱۶" (45 and
  41 offers for the first two items). The agent finds a 2-stop plan in Lalehzar, flags per-meter prices
  and one item only matched by shop category.

## 5. The agent journey (four steps defined by the organizers)

| Step | Persian label | Agent does | User sees |
|---|---|---|---|
| 1. Identify what the user wants | نیازسنجی | Turns free text into a Shopping Brief; if the model is unclear, runs guided discovery and shortlists models | Brief bar; discovery chips; model shortlist |
| 2. Search and compare | جستجو و مقایسه | Finds matching products, compares specs and nearby prices, explains ranking | Product cards, compare table, "why this" chips |
| 3. Find and compare sellers | یافتن و مقایسه فروشنده‌ها | Filters sellers by the user's profile and request (price, area, hours at arrival, installments, warranty); ranks and compares them side by side | Seller list with reason chips, seller compare table, map |
| 4. Contact sellers and plan the visit | تماس با فروشنده و برنامه مراجعه | Asks sellers for latest price and stock; handles no answer and closed shops with alternatives; builds the visit plan with directions to pasaj, floor and unit | Inquiry tracker, updated plan, route |

The user can enter at any step (e.g. open a shared product link and jump to step 3) and go back without
losing the brief.

## 6. Agent design

### 6.1 Shopping Brief (agent state)

One structured object per session, the single source of truth for both the agent and the UI:

```
ShoppingBrief
  need               free-text need, use case and must-have features (for discovery)
  items[]            resolved product_id(s) or category, quantity, unit (piece | meter)
  budget             max total and/or per item, toman
  origin             user's current location (GPS) or a picked point
  area               center (lat, lon) + radius, or a named area / pasaj
  visit_window       date, earliest arrival, latest departure
  travel_mode        walk | transit | car
  payment            any | cash | Torob Pay in person | installment (provider)
  must_have          warranty, test-in-presence, fast delivery as fallback
  priority           cheapest | closest | most reliable  (ranking preset)
  plan               ordered stops (see 6.5)
  inquiries[]        seller contacts and their status (see 6.4)
```

UI controls (chips, sliders, the brief bar) edit the brief directly and re-run deterministic queries
without calling the LLM. The LLM is used for understanding language, guided discovery, choosing tools,
explaining, and talking to sellers. This keeps filter changes instant and makes the agent's state
visible and editable.

### 6.2 Orchestrator

A tool-calling LLM loop:

1. Read the user turn and the current brief.
2. Update the brief (structured output). If a missing field would change the answer, ask with chips
   (e.g. area: "جمهوری / لاله‌زار / نزدیک من"), one question at a time.
3. If the request names a need or category rather than a model, run guided discovery (6.3,
   `suggest_models`) before listing sellers.
4. Call tools, observe, repeat until it can answer.
5. Reply as **blocks**: short text plus typed cards (`model_shortlist`, `product_cards`,
   `compare_table`, `seller_list`, `seller_compare`, `inquiry_status`, `alternatives`, `visit_plan`,
   `directions`). The UI renders numbers from tool data, not from LLM text.

### 6.3 Tools

| Tool | Step | Purpose | Backed by |
|---|---|---|---|
| `search_products(query, filters)` | 1-2 | Hybrid search over products (Persian/English title, brand, category, specs) | Lexical + vector index |
| `suggest_models(need, must_have, budget, area)` | 1 | Shortlist 2-3 models for an unclear need: candidates by spec fit, nearby availability and price; returns trade-offs per model | products + offers |
| `get_product(product_id)` | 2 | Full specs, images | products |
| `compare_products(product_ids)` | 2 | Spec diff, nearby price range, nearby seller count | products + offers |
| `find_sellers(product_ids, brief)` | 3 | Offers joined with shops, filtered by the brief, ranked, each with reason chips and trust level | offers + shops + geo |
| `compare_sellers(offer_ids)` | 3 | Side-by-side seller table (L5) | offers + shops + inquiries |
| `shop_details(shop_id)` | 3 | Parsed hours, open-at check, pasaj/floor/unit, payment, delivery, links | shops |
| `contact_seller(shop_id, offer_id, questions)` | 4 | Start an inquiry via the Seller Liaison: stock, latest price, hold, installments | 6.4 |
| `fetch_site_price(shop_id, product_id)` | 4 | Read the latest price from the seller's website, where one exists (P1) | live web fetch + extraction |
| `get_inquiries()` | 4 | Current inquiry status | inquiries store |
| `find_alternatives(offer_id, brief, reason)` | 3-4 | Ranked replacements when a seller is closed, silent, out of stock or over budget (F6) | offers + shops + geo |
| `plan_visit(shop_ids, origin, depart_at, mode)` | 4 | Ordered stops, ETAs, open-at-ETA checks, same-pasaj grouping | geo + hours |
| `get_directions(origin, shop_id, mode)` | 4 | Route, distance and time to the pasaj, plus the in-pasaj leg | routing API + parsed address |
| `optimize_basket(items, brief)` | 3 | Shops covering a list with fewest stops, then lowest cost (P1) | offers |

### 6.4 Seller Liaison (sub-agent for contacting sellers)

Getting the latest price and stock is where the agent acts for the user, so it is a separate sub-agent
with a narrow job:

- **Check first.** Before contacting, check the shop's hours. If closed now, say so and offer open
  alternatives straight away; the user can still queue a message for opening time.
- **Compose.** A short, polite Persian message per shop: is item X available now, what is today's
  price, can you hold it until 17:00, do you accept installments / Torob Pay.
- **Consent first.** Nothing is sent until the user taps "استعلام از ۳ فروشنده". Max 3 parallel
  inquiries per item.
- **Send** through a channel adapter. Hackathon: the Seller Console (below). Later: WhatsApp, Bale, SMS,
  or a voice agent, once publishable contact fields are known.
- **Parse replies** (free text or quick-reply buttons) into
  `{available: yes|no|unknown, latest_price, hold_until, installments, notes, confidence}`. Ambiguous
  reply -> one follow-up question to the seller.
- **Track.** States: `draft -> sent -> replied -> confirmed | unavailable | no_reply`, plus `closed`
  (shop closed when checked). No reply in N minutes (configurable, 2 in the demo) -> `no_reply`.
- **Fall back.** On `unavailable`, `no_reply` or `closed`, the orchestrator calls `find_alternatives`
  and shows the top 2 with one-line trade-offs; one tap sends them an inquiry too.
- **Report.** Confirmed price replaces the listed price in the seller comparison and budget; confirmed
  shops move up in the plan.

**Seller website (P1).** For shops with a website (43 shops with 6,846 offers), `fetch_site_price`
fetches the product page or site search and has the LLM extract the price. The result is labeled as a
website price with its fetch time; it says nothing about stock. This is the only live, non-simulated
price source in the dataset.

**Seller Console (demo).** A small mobile web page per shop showing incoming inquiries with quick replies
("موجود است", "موجود نیست", "قیمت امروز: ...", "تا ساعت ... نگه می‌دارم") and free text. A second
phone plays the seller in the demo video. A P1 auto-responder (an LLM role-playing a seller, with
configurable out-of-stock, no-reply and price-change rates) runs unattended demos. The UI labels all of
this as simulated.

### 6.5 Visit plan and directions

- **Input:** chosen shops, origin (GPS or picked on map), departure time, travel mode.
- **Per stop:** ETA, open-at-ETA from parsed hours (multi-shift days, midday breaks, Thursday early
  close, Friday closures). Unknown hours -> "ساعت کاری ثبت نشده", not hidden.
- **Getting there:** route preview from the origin to the shop's coordinates with distance and time
  (routing API; straight-line estimate if unavailable), and one-tap "open in Neshan / Balad / Google
  Maps" for turn-by-turn.
- **Inside the pasaj:** pasaj name, landmark from the address ("نبش کوچه کلانتری"), floor and unit, shown
  as the last step of the route ("طبقه ۶، واحد ۶۲۲"). Several stops in one pasaj are grouped and ordered
  by floor.
- **Order:** brute force for <= 6 stops (enough for the scope).
- **Share:** plan link with stops and routes.

### 6.6 Proactive behavior

The agent keeps working after the answer:

- Inquiry replied / timed out / shop closed -> update plan, offer alternatives, notify.
- A planned shop closes before ETA ("پنجشنبه تا ۱۴ باز است؛ تا ۱۳:۱۵ حرکت کنید") -> warn and offer a swap.
- Latest price differs from the listed price -> show the difference and re-check budget.
- (P2) Geofence: user arrives at a pasaj -> switch to in-pasaj mode, list stops by floor.

### 6.7 Grounding rules (hard requirements)

1. Every product, shop, price, hour and address shown comes from a tool result. The UI renders these
   fields; the LLM only references them by id.
2. The agent never says "موجود است" unless a seller confirmed it, with the time of confirmation.
3. Category-only shops are never presented as having the product.
4. Model recommendations in discovery cite the spec values they rely on.
5. When data is missing the agent says so and offers the next action (ask the seller, widen area,
   include unknowns).
6. If the user's area has no coverage, the agent says so and suggests the nearest covered area or
   fast-delivery shops.

## 7. Features and requirements

Priority: **P0** = needed for the demo and judging, **P1** = strong add, **P2** = if time allows.

### 7.1 Step 1: Identify what the user wants

| ID | Requirement | P |
|---|---|---|
| U1 | Free-text Persian input (also Finglish and English brand names), parsed into the brief | P0 |
| U2 | Brief bar, always visible: area, budget, time, payment, priority; each a tappable chip that edits in place | P0 |
| U3 | Clarifying questions as chips, one at a time, only when the answer changes the result | P0 |
| U4 | Guided discovery ("کمکم کن انتخاب کنم"): for a need or category, up to 3 chip questions (use, must-haves, budget), then a shortlist of 2-3 models, each with plain-language trade-offs, key specs, nearby price range and seller count | P0 |
| U5 | Origin via browser geolocation, or pick a point / area / pasaj on the map | P0 |
| U6 | Paste a multi-line shopping list -> basket mode (L10) | P1 |
| U7 | Voice input | P2 |
| U8 | Photo of a product -> search | P2 |

### 7.2 Step 2: Search and compare

| ID | Requirement | P |
|---|---|---|
| S1 | Hybrid search: normalized Persian lexical match + semantic vectors; brand/category boosts | P0 |
| S2 | Product card: image, title, key specs, nearby price range, number of nearby sellers, age of the newest price | P0 |
| S3 | Compare up to 3 products: spec diff (differences highlighted), price range, seller count, warranty | P0 |
| S4 | "Why this?" on every recommendation: score parts shown as chips, plus one grounded sentence | P0 |
| S5 | Price sanity flags: placeholder, invalid, far below / above nearby median, per-meter unit | P0 |

### 7.3 Step 3: Find and compare sellers

| ID | Requirement | P |
|---|---|---|
| L1 | Area filter (radius around origin, named area, or one pasaj) with live result count | P0 |
| L2 | "Open at my arrival time" filter; unknown-hours shops in a separate group, not dropped | P0 |
| L3 | Condition filters: installment (by provider: ترب‌پی، اسنپ‌پی، دیجی‌پی، تارا، ازکی‌وام), Torob Pay in person, warranty, fast delivery; shops with unknown values in a separate "ask them" group | P0 |
| L4 | Seller list ranked by the brief's priority, each with reason chips ("نزدیک‌ترین", "ارزان‌ترین", "الان باز است", "گارانتی ۱۸ ماهه", "اقساط اسنپ‌پی") and trust badge | P0 |
| L5 | Compare up to 3 sellers side by side: listed price and age, latest price if fetched or confirmed, distance and travel time, open at arrival, warranty, payment and installments, delivery, trust level | P0 |
| L6 | Shop page: name, pasaj, floor, unit, hours today and this week, payment options with their channel, delivery, website / Instagram when present | P0 |
| L7 | Map with shop pins clustered by pasaj; list/map toggle | P0 |
| L8 | Sort presets: cheapest / closest / most reliable (fresher price, warranty, declared hours) | P1 |
| L9 | Pasaj view: all relevant shops in one pasaj, grouped by floor | P1 |
| L10 | Basket optimizer: fewest stops covering a list, then lowest total; shows what each stop covers and what is missing | P1 |

### 7.4 Step 4: Contact sellers and plan the visit

| ID | Requirement | P |
|---|---|---|
| F1 | Seller Liaison: check hours, compose, user consent, send, parse, track (6.4) | P0 |
| F2 | Seller Console with quick replies (demo channel) | P0 |
| F3 | Inquiry tracker: per-shop status timeline, latest price, hold time | P0 |
| F4 | Latest price from a seller replaces the listed price in seller comparison, budget and plan, with source and time | P0 |
| F5 | No answer / closed: closed shops flagged before contact; no reply after N minutes -> `no_reply`; both trigger alternatives automatically | P0 |
| F6 | Alternatives, in this order: same product at another open shop near the plan (same pasaj first); similar product (same category, close specs, within budget) nearby; category-only shops with "ask them" action; fast-delivery shops | P0 |
| F7 | Each alternative states the trade-off in one line ("۲۰۰ هزار تومان گران‌تر، همین پاساژ، الان باز است") and can be contacted with one tap | P0 |
| F8 | Visit plan: ordered stops, ETAs, open-at-ETA status, confirmed badges; auto-updates after replies and accepted alternatives | P0 |
| F9 | Directions: route from origin with distance and time, "open in Neshan / Balad / Google Maps", then pasaj, landmark, floor and unit | P0 |
| F10 | Closing-time and price-change nudges (6.6) | P1 |
| F11 | `fetch_site_price` for shops with a website | P1 |
| F12 | Seller auto-responder for unattended demos | P1 |
| F13 | Ready-to-send message for the user to send on WhatsApp/Bale themselves | P1 |
| F14 | Post-visit check-in: "خرید انجام شد؟" -> close the session or resume with alternatives | P2 |

## 8. Information transparency

Per the transparency requirements in 1.1, every offer and shop field carries one of these levels:

| Level | Meaning | Persian label (draft) | Visual |
|---|---|---|---|
| Confirmed | Seller confirmed stock and price via inquiry, with time | موجودی و قیمت تأییدشده توسط فروشنده - ساعت ۱۱:۳۰ | solid green badge |
| Website price | Price read from the seller's site; stock not confirmed | قیمت سایت فروشنده - ساعت ۱۱:۳۰ - موجودی تأیید نشده | blue badge |
| Listed | Shop listed this exact product with a price in the dataset | قیمت ثبت‌شده | neutral badge + price age |
| Category only | Shop's activity category matches; product not listed | فقط دسته فعالیت - موجودی نامشخص | outline badge, never in "has product" lists |
| Unknown | Field not recorded | ثبت نشده | grey text, never blank |

Inquiry outcomes are shown too: "پاسخ نداد" (no reply) and "الان بسته است" (closed), each with the
alternatives next to it.

Rules:

- **Price age.** `last_price_changed_at` is when the price last *changed*, not when it was last checked.
  Label it "آخرین تغییر قیمت: ۸ روز پیش", never "به‌روز شده". Age buckets: <= 7 days, 8-30 days,
  > 30 days (shown as "قیمت قدیمی، استعلام بگیرید").
- **Missing price.** "قیمت ثبت نشده" with an "ask the seller" action.
- **Units.** If the seller title says per meter ("متری") show "قیمت هر متر" and multiply by quantity in
  baskets.
- **Payment info.** Show the channel the seller declared (in person vs unknown). "Installments
  available" is only shown when declared or confirmed in an inquiry.
- **Coverage.** A short note in empty states: data covers part of Tehran's shops, mostly downtown.
- **Simulation.** Seller replies in the demo are labeled as simulated.

## 9. UX

### Principles

- **One sentence in, taps after.** Chat starts the task; chips, cards and buttons carry it.
- **Every screen has a next step.** Cards end with the obvious action: compare, see sellers, ask
  sellers, see alternatives, get directions.
- **Change a condition, see the result.** Brief bar edits re-rank instantly.
- **No dead ends.** Empty result, silent seller or closed shop -> say why and offer the next best option.
- **Persian and RTL.** Vazirmatn font, Persian digits in UI, toman with thousands separators, Jalali dates.
- **Mobile first.** Bottom sheet for the agent, thumb-reachable actions, works at 360 px width, fast on
  3G-class networks.

### Key screens

1. **Home.** Input box with examples, "کمکم کن انتخاب کنم" entry, recent sessions, "near me" chip.
2. **Discovery.** Chip questions, then the model shortlist with trade-offs.
3. **Results / compare products.** Brief bar on top; product cards; compare tray; agent bottom sheet.
4. **Sellers.** Filters (area, open at arrival, installments, warranty), ranked list, map, seller
   compare table.
5. **Inquiries.** Per-shop status timeline (sent, replied, no reply, closed); alternatives inline.
6. **Visit plan.** Map + timeline of stops (route time, pasaj, floor, unit, open status, confirmed
   badge), "open in map app", share.
7. **Shop.** Hours this week, address parts, payment, delivery, links.
8. **Seller Console** (demo, separate route): inbox with quick replies.

## 10. Data

### 10.1 What the dataset holds (profiled 2026-10-21)

| Table | Rows | Notes |
|---|---|---|
| shops | 6,476 | 3,792 (59%) have at least one offer; 2,684 have category only |
| products | 225,903 | 3,428 categories; brand on 25%; specs on 64%; images on 99.5%; model on 2% |
| offers | 331,506 | price missing on 4.5%; warranty on 18%; description on 12% |

Findings that shape the product:

- **Downtown-heavy.** 85% of shops are in three location labels: فردوسی (3,282), شیخ هادی (1,587),
  بهارستان (616). Top categories are electrical, lighting, CCTV, mobile accessories and industrial
  parts. The demo should live in Jomhouri / Lalehzar.
- **Pasaj data is in the address text.** 49% of addresses name a pasaj (about 500 distinct strings with
  spelling variants, e.g. علاالدین / علاءالدین / علاالدین ۲), 65% name a floor, 93% a unit or plaque.
  Coordinates are real and serve as the route destination.
- **Hours.** 69% of shops have weekly hours (79% of shops with offers). Statuses: `declared`, `closed`,
  `unsupported`. Most declared days carry a placeholder `00:00-00:00` second shift that must be dropped.
  Friday: 3,473 closed vs 998 declared.
- **Payment options** on only 4% of shops. Providers: ترب‌پی, اسنپ‌پی, دیجی‌پی, تارا, ازکی‌وام; channel
  `in_person` or `unknown`; min/max price mostly null or 0. The installment filter will return mostly
  "unknown" shops, so the "ask them" group (L3) and the installment question in inquiries matter.
- **Fast delivery:** true 1,168, false 433, unknown 4,875.
- **Contacts:** phone only, all fake. 112 shops have real names: 90 with a website (43 of them have
  offers, 6,846 offers in total) and 22 with Instagram (3 with offers, 17 offers). Other shop names are
  fake. Locations are real.
- **Price quality.** 1,645 offers under 1,000 toman (placeholders), 211 over 10^10 toman (invalid).
  About 9.4k seller titles mention per-meter pricing.
- **Price age.** Changes range from 2020-12 to 2026-10-13; 65% fall in Sep-Oct 2026.
- **Comparison depth.** Median offers per product is 1. 38,899 products have >= 2 offers, 8,073 have
  >= 5. Seller comparison works for a subset; the UI must look fine with a single seller, and
  `suggest_models` should prefer models with several nearby sellers.

### 10.2 Ingest and cleaning

One reproducible script: CSV -> clean -> load -> index. Rules:

- Persian text normalization for search: Arabic ي/ك -> ی/ک, unify ZWNJ and spaces, Persian/Arabic digits
  -> ASCII for matching, strip diacritics and hamza variants (علاءالدین == علاالدین).
- Parse JSON columns (contacts, weekly_hours, payment_options, warranty, specs, image_urls, instagram,
  category_names).
- Hours: drop `00:00-00:00` shifts, keep `closed` and `unsupported` as distinct states, timezone
  Asia/Tehran, week keys sat..fri.
- Address: extract pasaj name (normalized), floor, unit and landmark; keep the raw address for display.
- Price: flag `missing`, `placeholder` (< 1,000), `invalid` (> 10^10), `per_meter` (from seller title);
  compute per-product median across valid offers for the "far from median" flag.
- Warranty: provider, months, description; recognize "تست و تحویل در حضور مشتری" and "بدون گارانتی".
- Specs: flatten to key/value per product for spec diffs and discovery filters.
- Embeddings: precompute for product titles (+ brand, category) once at build time.

## 11. Technical approach

Proposed stack; swap freely, the PRD only depends on the capabilities.

- **Backend:** Python (FastAPI). Agent loop with tool calling; tools are plain functions with typed
  inputs/outputs, shared by the agent and the REST endpoints the UI calls directly.
- **Database:** PostgreSQL with PostGIS (distance, area), pg_trgm (fuzzy Persian match), pgvector
  (semantic search). The dataset fits in one instance.
- **LLM:** a tool-calling model behind one provider interface, so the provider can change if access from
  the server's region is a problem. A smaller model can parse seller replies and website prices.
- **Frontend:** React (e.g. Next.js) PWA, RTL, Vazirmatn; map with Leaflet + OSM tiles or an Iranian map
  SDK (Neshan / Balad) for better local labels, routing and deep links.
- **Realtime:** SSE (or WebSocket) for streaming agent blocks and inquiry updates.

Quality:

- Eval set of ~30 Persian queries (anchor scenarios, vague needs, typos, Finglish, conditions) with
  expected products/shops; run on every change.
- Unit tests for hours parsing, address parsing, price flags, inquiry state machine, basket optimizer.
- Transcript check: no price, shop or availability claim in agent text that is not in tool output.

## 12. Deployment

- Docker Compose: `app`, `web`, `db`; HTTPS via a reverse proxy (e.g. Caddy) on one VPS.
- Data load as a one-shot job from the CSVs; idempotent; DB snapshot kept for fast restore.
- Health endpoint, structured logs, restart policy.
- Secrets (LLM key, map key) via env; app degrades without them (search, filters and plans still work;
  agent replies fall back to template text; routes fall back to straight-line estimates).
- Public URL live and stable well before submission; the demo video is recorded against it.

## 13. Success criteria

### Judging map

Against the rubric in 1.1:

| Criterion | Points | How this PRD answers it |
|---|---|---|
| Product | 75 | Four steps end to end; all five pain points covered (section 2) |
| UX | 75 | Brief bar, discovery chips, cards, seller compare, "why this", no dead ends, mobile RTL |
| Intelligence | 50 | Guided model discovery, Seller Liaison for latest price, no-reply/closed fallback with alternatives, time/place/need-aware planning, nudges |
| Deployment | 40 | Public HTTPS URL, Docker Compose, reproducible data load, degraded mode |
| Technical | 40 | Typed tools, grounded agent, hybrid search, PostGIS, evals and tests |
| Dataset | 20 | Trust levels, price age, unknowns shown, cleaning rules, coverage note |

### Product targets

- Filter changes re-render in < 1 s; first agent card streams in < 5 s.
- Eval set: relevant product in top 5 for >= 80% of queries; for vague needs, the shortlist holds a
  reasonable model with nearby sellers.
- Zero ungrounded prices, shops or availability claims across the eval transcripts.
- Every recommended seller shows at least one reason chip and its trust level.
- Anchor scenario A completes (vague need -> confirmed plan with directions and one alternative) in
  under 3 minutes of user time.

## 14. Demo video (about 5 minutes)

| Time | Step | Content |
|---|---|---|
| 0:00-0:30 | | The problem in one story: a wasted trip to Jomhouri |
| 0:30-1:20 | 1 | Scenario A: vague need -> two chip questions -> model shortlist with trade-offs |
| 1:20-1:55 | 2 | Compare two models, pick one |
| 1:55-2:45 | 3 | Sellers near Jomhouri open at 17:00; toggle installments (declared vs "ask them"); compare 3 sellers |
| 2:45-4:05 | 4 | Ask 3 sellers -> Seller Console: one confirms a new price, one no reply, one closed -> alternative in the same pasaj -> plan updates -> route from current location to pasaj, floor, unit; open in map app |
| 4:05-4:35 | | Transparency: listed vs confirmed price, price age, unknown hours, coverage note |
| 4:35-5:00 | | Architecture in one slide, live URL |

Demo prep: pick the demo product after checking it has several sellers in one pasaj near Jomhouri and
at least one seller with declared installments.

## 15. Risks

| Risk | Mitigation |
|---|---|
| LLM API unreachable or slow from the server's region | Provider interface; deterministic search/filter/plan work without the LLM; streaming |
| Guided discovery recommends a weak or unavailable model | Candidates restricted to products with nearby sellers; trade-offs cite specs; eval cases for vague needs |
| Persian search misses (spelling, ZWNJ, Finglish) | Normalization + trigram + vectors; eval set catches regressions |
| Sparse fields (hours 31% missing, payment 96% missing) | "Unknown" groups instead of silent filtering; ask about them in the inquiry |
| Fake contacts | Simulated channel, clearly labeled; adapter ready for real channels |
| Seller websites differ in layout, block bots, or are unreachable from the server | P1 only; per-site timeout; failure falls back to inquiry; never blocks the flow |
| Map / routing API keys or quotas | OSM tiles; straight-line estimates; map-app deep links still work |
| Narrow coverage | Coverage note, nearest covered area, fast-delivery fallback |
| Demo flakiness | Seeded scenarios, auto-responder, backup recording |

## 16. Open questions

1. **Publishable contact fields** "will be specified in the final version". This decides whether
   inquiries can use real channels (WhatsApp / Bale links) or stay simulated.
2. **LLM provider and hosting region** (Iranian cloud vs abroad) affect LLM, map and seller-website
   access.
3. **Team size and deadline** decide where the P0/P1 line falls.
4. **Fake shop names.** Assumed fine to display as-is, since organizers made them consistent with the
   rest of the data.

## 17. Build order

1. Ingest + cleaning + DB + search API (S1, 10.2), with tests for parsers.
2. Results, product compare, seller list and seller compare with brief bar and trust badges (U2, S2-S5,
   L1-L7, section 8).
3. Orchestrator with tools and block rendering, guided discovery (6.2, 6.3, U1, U3, U4).
4. Seller Liaison, Seller Console, inquiry tracker, no-reply/closed fallback, alternatives (F1-F7).
5. Visit plan and directions (F8, F9).
6. Deployment (section 12), then eval set and demo rehearsal.
7. P1 items in order of demo value: website price fetch, nudges, auto-responder, pasaj view, basket.
