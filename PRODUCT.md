# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

Mobile web first (works at 360 px), Persian, RTL. No native app.

## Users

Design priority, confirmed: the hackathon judges and the 5-minute narrated demo video come first. Work is
judged on a 300-point rubric (Product 75, UX 75, Intelligence 50, Deployment 40, Technical 40, Dataset 20),
mostly through the video, so every flow must read clearly on a phone screen in a recording.

The product's users, as the demo presents them (PRD section 4):

- **Unsure buyer:** knows the need ("هندزفری برای باشگاه"), not the model. Wins with a model they trust, then a seller.
- **Model-known buyer:** wants to see and test before buying at a fair price. Wins with a confirmed latest price and no wasted trip.
- **Installment buyer:** must pay by installment or Torob Pay in person. Wins with only shops that meet the condition, unknowns shown honestly.
- **Urgent buyer:** needs it today near work. Wins with open now, close by, seller answered.
- **Basket buyer:** a parts list (e.g. an electrician). Wins with the fewest stops that cover the list.
- **Seller (demo role):** answers inquiries in the Seller Console on a second phone in the video.

## Product Purpose

Pasazhgard (پاساژگرد) is an AI shopping agent for buying in person from shops, pasajs and malls in Tehran,
built on Torob's dataset for Torob's hackathon. The user says what they need in plain Persian; the agent
helps pick a model, compares products, finds and compares sellers that fit budget, location, hours and
payment, contacts sellers for the latest price and stock, falls back to alternatives when a seller is silent
or closed, and guides the user to the pasaj, floor and unit.

Success: a judge watching the demo sees all four organizer steps (نیازسنجی، جستجو و مقایسه، یافتن و مقایسه
فروشنده‌ها، تماس و برنامه مراجعه) and all five pain points handled end to end, on a stable public deployment.

## Positioning

The agent is the product, not a chat box on top of a search page. It holds the user's goal as a visible,
editable Shopping Brief, acts on the user's behalf (asks sellers, swaps in alternatives, rebuilds the plan),
and keeps working after the first answer. Every fact carries how sure we are: confirmed by seller, website
price, listed, category only, or unknown.

## Operating Context

- Anchor demo scenarios: A (unsure buyer, Bluetooth earbuds, Jomhouri, 17:00, installments, one seller
  confirms, one silent, one closed) and B (electrical parts basket, 2-stop plan in Lalehzar). PRD section 4.
- Data is downtown-heavy (Ferdowsi, Sheikh Hadi, Baharestan); the demo lives in Jomhouri / Lalehzar.
- Seller contact is simulated through the Seller Console (route `/console/[shopId]`); all phone numbers in the
  dataset are fake.
- Deployed on Liara (torob-api + torob-web). Playwright CDN is blocked from Iran.

## Capabilities and Constraints

- Stack is fixed by `docs/adr/`: FastAPI + Postgres (PostGIS, pgvector, pg_trgm) backend, Next.js RTL web
  with CopilotKit for the agent.
- Chat starts the task; chips, cards and buttons carry it. Brief edits re-rank without the LLM.
- Numbers on screen come from tool data, never from LLM text (PRD 6.7 grounding rules).
- Non-goals: online checkout, real messages to real shops, indoor pasaj maps, user accounts, coverage
  beyond the dataset (about 10% of Tehran shops).
- Terminology: pasaj (پاساژ), Shopping Brief, inquiry (استعلام), Seller Liaison, Seller Console.

## Brand Commitments

- Binding: Pasazhgard wears Torob's clothes. Torob's palette and feel stay (slate ink on a light grey
  ground, white flat cards, brand red only for the one buy/CTA per screen, Torob blue for contact actions,
  Vazirmatn). Details live in `docs/design/direction.md` and `docs/design/torob-reference.md`.
- Name: پاساژگرد / Pasazhgard (working name in the PRD).
- Persian digits in UI, toman with thousands separators, Jalali dates.

## Evidence on Hand

- Torob dataset in `dataset/`: 6,476 shops, 225,903 products, 331,506 offers. 6,364 shop names are fake;
  locations are real. Product images are Torob CDN URLs.
- Torob reference screenshots: `docs/design/torob/`. Mocks: `docs/design/mocks/`.
- No real users, testimonials, usage numbers or seller partnerships. Distances, hours and inquiry states
  in mocks are made up. Seller replies are simulated and must be labeled so.

## Product Principles

1. **Readable in the video.** Each step of the journey must be obvious to a judge in a few seconds on a
   phone recording.
2. **Never overstate a fact.** Listed price, price-change time and confirmed stock are different things;
   unknown is shown, never blank. "موجود است" only after a seller confirmed it.
3. **One sentence in, taps after.** Every screen ends in its next step; no dead ends.
4. **Show why.** Every recommendation says why it was picked.
5. **The agent acts.** Show the agent doing work for the user (inquiries, fallbacks, plan updates), not just answering.

## Accessibility & Inclusion

WCAG 2.2 AA: text contrast, 44 px tap targets, Persian screen-reader labels, RTL reading order.
