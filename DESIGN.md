---
name: Pasazhgard
description: In-person shopping agent for Tehran's pasajs, dressed in Torob's clothes.
colors:
  ground: "#f1f5f9"
  ink: "#1e293b"
  surface: "#ffffff"
  muted-ink: "#64748b"
  border: "#cbd5e1"
  hairline: "#e2e8f0"
  torob-red: "#d73948"
  inquiry-blue: "#3468cc"
  open-green: "#4caf50"
  closed-red: "#e02020"
  confirmed-wash: "#daf2d5"
  confirmed-ink: "#0b5124"
  notice-ink: "#92400e"
  notice-text: "#b45309"
  notice-line: "#f59e0b"
  notice-wash: "#fffbeb"
typography:
  title:
    fontFamily: "Vazirmatn Variable, sans-serif"
    fontSize: "16px"
    fontWeight: 700
    lineHeight: "28px"
  body:
    fontFamily: "Vazirmatn Variable, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: "24px"
  label:
    fontFamily: "Vazirmatn Variable, sans-serif"
    fontSize: "14px"
    fontWeight: 700
    lineHeight: "24px"
  meta:
    fontFamily: "Vazirmatn Variable, sans-serif"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: "20px"
rounded:
  md: "8px"
  xl: "16px"
  full: "9999px"
spacing:
  gap: "8px"
  card: "16px"
  chip-bar: "52px"
  row-button: "40px"
  chip: "36px"
  search: "48px"
  agent-bar: "56px"
components:
  button-buy:
    backgroundColor: "{colors.torob-red}"
    textColor: "{colors.surface}"
    typography: "{typography.label}"
    rounded: "{rounded.md}"
    height: "{spacing.row-button}"
    padding: "0 16px"
  button-contact:
    backgroundColor: "{colors.inquiry-blue}"
    textColor: "{colors.surface}"
    typography: "{typography.label}"
    rounded: "{rounded.md}"
    height: "{spacing.row-button}"
    padding: "0 16px"
  button-contact-outline:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.inquiry-blue}"
    typography: "{typography.label}"
    rounded: "{rounded.md}"
    height: "{spacing.row-button}"
    padding: "0 16px"
  button-ink:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.surface}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    height: "32px"
    padding: "0 10px"
  chip-filter:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.full}"
    height: "{spacing.chip}"
    padding: "0 12px"
  chip-filter-pressed:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "{rounded.full}"
    height: "{spacing.chip}"
    padding: "0 12px"
  badge-reason:
    backgroundColor: "{colors.ground}"
    textColor: "{colors.ink}"
    rounded: "{rounded.full}"
    height: "20px"
    padding: "2px 8px"
  card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.xl}"
    padding: "{spacing.card}"
  input-search:
    backgroundColor: "{colors.ground}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    height: "{spacing.search}"
    padding: "0 12px"
---

# Design System: Pasazhgard

## Overview

**Creative North Star: "The Bazaar Ledger"**

Pasazhgard reads like a ledger kept by someone who knows the pasaj: slate ink on a cool grey ground, white
rows of facts, and every price written down with where it came from and how old it is. The look is Torob's
own, carried from the online catalogue into in-person shopping, so a judge or a Torob user recognises it
at once. Expression lives in exactness, not ornament: the right word for an unknown, the age of a price,
the floor and unit.

The density is mobile and calm. At 360 px a screen holds a sticky filter chip bar, a stack of white cards
8 px apart, and one docked action. Dark mode follows the system and uses Torob's dark palette. There is no gradient, no shadow on content, and no
display type: the largest text is 16 px. Colour is rationed. Red marks the one buy or commit action per
screen, blue marks talking to a seller or going there, and green and red only report open, closed and
confirmed.

**Key Characteristics:**
- Torob's palette and type, light and dark (system setting), right-to-left Persian.
- Flat white cards on a grey ground; the colour step is the edge.
- Three type sizes (12, 14, 16) at two weights (400, 700).
- One filled action per result, one red action per screen.
- Every fact has a labelled slot; missing values read "نامشخص", never blank.

## Colors

A slate-ink neutral system with two rationed accents and a small set of status colours.

### Primary
- **Torob Red** (`torob-red`): the single buy/commit action on a screen: the sellers dock ("استعلام از N فروشنده"), the home search submit, the composer send, the plan share. It is the flat end colour of Torob's buy gradient.

### Secondary
- **Inquiry Blue** (`inquiry-blue`): contact and route actions: "استعلام بگیرید", "مسیر تا فروشگاه", map-app deep links (outline), the "دیدن فروشنده‌ها" text link. Also the focus ring.

### Tertiary (status)
- **Open Green** (`open-green`): an 8 px dot beside the ink label "الان باز". Never text (2.8:1 on white).
- **Closed Red** (`closed-red`): the word "بسته" and destructive states.
- **Confirmed Wash / Confirmed Ink** (`confirmed-wash`, `confirmed-ink`): seller-confirmed stock and price; "موجود است" is set in confirmed ink at 700.
- **Notice family** (`notice-ink`, `notice-text`, `notice-line`, `notice-wash`): warnings and highlights. Notice ink for the old-price suffix "، قدیمی" (over 30 days); notice text for "قیمت قدیمی، استعلام بگیرید" on product cards; notice wash for differing rows in the product compare table and the closing-time warning box; notice line for that box's border, the current plan stop and the selected map pin.

### Neutral
- **Slate Ink** (`ink`): all text on the grey ground, titles, prices, icons, default buttons, pressed chips, the user's chat bubble.
- **Cool Ground** (`ground`): the page background, the search field, reason badges, row dividers (`--rule`).
- **White Surface** (`surface`): cards, drawers, the chip bar, image wells.
- **Muted Ink** (`muted-ink`): meta text, sources, "نامشخص". On white only (4.76:1); on the grey ground it drops to 4.3:1.
- **Border** (`border`): chip and input strokes. **Hairline** (`hairline`): the 1 px frame around the price/age/availability slots.

### Named Rules
**The One Red Rule.** Torob Red appears on at most one control per screen. If a second action wants red, it is blue, outline or ghost.

**The Talk-Is-Blue Rule.** Any action that contacts a seller or leads to a shop is Inquiry Blue. Blue never means "buy".

**The Muted-On-White Rule.** Muted ink sits only on white surfaces. Text on the grey ground is ink. Placeholders in the grey search field are the one exception, as on Torob.

## Typography

**Body Font:** Vazirmatn Variable (with sans-serif)

**Character:** One Persian sans at two weights does all the work; hierarchy comes from weight and slot position, not size. Latin model names stay Latin inside Persian text.

### Hierarchy
- **Title** (700, 16px, 28px): page titles in the app bar, shop names, the seller price.
- **Body** (400, 14px, 24px): body text, chips, product meta lines. Product titles use 14/700 and clamp to two lines.
- **Label** (700, 14px, 24px): button text, pressed chips, product prices.
- **Meta** (400, 12px, 20px): sources ("قیمت ثبت‌شده"), price age, distances, coverage notes. Reason badges use 12/700.

### Named Rules
**The Sixteen Ceiling Rule.** No text is larger than 16 px. A screen that wants a bigger headline wants a clearer slot instead.

**The Tabular Digits Rule.** Every number uses `tabular-nums` and goes through `faDigits`: Persian digits with U+066B as the thousands separator ("۳٫۳۴۰٫۰۰۰ تومان").

## Layout

Mobile first, built and checked at 360 x 740; no page may scroll sideways (`scrollWidth <= 360`). The page is a single column of white cards on the grey ground, 8 px apart, each with 16 px inner padding and 8 px between its lines. A white 52 px filter chip bar sticks under the app bar and scrolls sideways inside itself. Actions sit at thumb height: a 56 px agent bar at the bottom of the home screen, a docked action on the sellers screen, and the agent drawer opening from the bottom at a 0.9 snap point. Fixed control heights: chips 36 px, row buttons 40 px (44 px tap area with the gap), home search field 48 px, category tiles 56 px, composer 40 px.

Results switch between list and map with a 32 px segmented toggle. In map view the map fills the space under the chip bar and a row of compact cards is docked over its lower edge; the list is never hidden behind a second tap.

## Elevation & Depth

Flat. Content surfaces have no shadow and no border; a white card on the grey ground is the edge. Depth exists only for things that float over the page: the bottom drawer (white, rounded top, with the page dimmed by a black 10% backdrop and a light blur) and map pins (a small shadow so they read over map tiles).

### Named Rules
**The Paper-On-Grey Rule.** Cards are white rectangles on grey: no shadow, no ring, no outline. If a card needs separating from another card, the 8 px gap does it.

## Shapes

Two corner sizes. Gently curved 8 px corners on buttons, inputs, image wells and the slot frame; softer 16 px corners on cards, tiles and the drawer's top edge. Chips, reason badges, the open dot and map pins are fully round. Product images sit `object-contain` in a white 72 px square well.

## Components

### Buttons
Restrained and literal: the colour says what the button does.
- **Shape:** gently curved (8px). Row buttons are 40 px tall, 16 px side padding, 14/700.
- **Buy (Torob Red):** the screen's single commit action. Hover darkens to 90%.
- **Contact (Inquiry Blue):** "استعلام بگیرید", "مسیر تا فروشگاه". **Contact outline:** blue 1 px stroke and text on white, for map-app links and "جایگزین‌ها".
- **Ink (default):** slate fill, white text, for neutral actions; selected toggles also take ink.
- **Ghost:** no fill, ink text, for secondary row actions like "مسیر".
- **Focus:** 3 px ring in Inquiry Blue at 50%. **Active:** moves down 1 px. **Disabled:** 50% opacity, e.g. "استعلام فرستاده شد، ۱۱:۳۰".

### Chips
- **Filter chip:** white, 1 px border, fully round, 36 px, 14/400 ink.
- **Pressed:** 1.5 px ink border (a 1 px border plus a 0.5 px ring, because Chrome floors border widths) and 700 weight.
- **Suggestion chip** (agent drawer): white, 1 px border, 8 px corners; a tap sends its message.

### Reason badge
One per result, 12/700 ink on the grey ground, fully round, never coloured. It states why the result is shown: "ارزان‌ترین", "نزدیک‌ترین", "الان باز", a provider name, the pasaj name.

### Cards / Containers
- **Corner Style:** softly rounded (16px).
- **Background:** white on the grey ground.
- **Shadow Strategy:** none (see Elevation & Depth).
- **Border:** none.
- **Internal Padding:** 16 px, 8 px between lines.

### Inputs / Fields
- **Search field:** grey ground fill, 8 px corners, 48 px on home and 40 px in the composer, with a red square submit beside it.
- **Plain input:** 1 px border, transparent fill. **Focus:** border turns Inquiry Blue with a 3 px ring at 50%.

### Navigation
A white app bar with the red "پ" mark and the page title at 16/700. Under it, on routes that filter, the sticky chip bar. Sorting and the area, budget and full filter sets open as bottom drawers with a handle.

### Seller row (signature)
The ledger entry. Shop name (16/700, links to the shop) with its reason badge; one meta line (pasaj, floor, distance, the green dot and "الان باز"); the price slot (16/700) with its source in 12 muted; a white frame of 1 px hairline holding the "آخرین تغییر قیمت" and "موجودی" slots; then one filled action, a ghost "مسیر" and a compare toggle. The price slot shows, in order: confirmed price, website price, listed price, "قیمت: نامشخص".

### Agent drawer
A bottom drawer at a 0.9 snap point with a handle and a close button. It opens only on a tap. The brief chips at the top show what the agent understood; the user's bubble is an ink fill with white text; the agent writes one sentence at most, then cards and suggestion chips. While a tool runs, "در حال ..." and grey skeleton bars at the final block's real sizes stand in for it.

## Do's and Don'ts

### Do:
- **Do** give each result exactly one filled action and keep Torob Red to one control per screen.
- **Do** write a missing value as "نامشخص" in muted ink, in its labelled slot ("قیمت: نامشخص", "ساعت کاری: نامشخص").
- **Do** label price age "آخرین تغییر قیمت" and add "، قدیمی" in notice ink past 30 days.
- **Do** colour the open state with the 8 px green dot and keep the words in ink.
- **Do** check every new block at 360 px with no sideways page scroll.

### Don't:
- **Don't** add a shadow, ring or border to a content card.
- **Don't** set text above 16 px or use weights other than 400 and 700.
- **Don't** use Open Green as a text colour or Torob Red for anything that isn't the screen's commit action.
- **Don't** colour reason badges or show more than one per result.
- **Don't** write "به‌روز شده" for a price, or "موجود است" before a seller confirmed it.
- **Don't** use Torob's gradient buttons; the flat fill is the gradient's end colour.

Known drift (the code does not yet follow these rules): `text-lg`/`text-xl` and `font-semibold`/`font-medium` appear in 13 files, mostly blocks outside the redesign (`shop-details`, `inquiry-tracker`, `pasaj-view`, `visit-plan`, compare tables, `basket`); the notice family is raw Tailwind amber utilities rather than tokens.
