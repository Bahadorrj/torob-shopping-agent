# Torob visual reference

Captured from torob.com on 2026-10-22 with a mobile Chrome context (Android UA, 360x780, DPR 2,
`isMobile`). Torob serves a different layout to desktop UAs, so a plain resized desktop browser is
not representative. All values below come from `getComputedStyle` or Torob's own CSS custom
properties (`html[data-theme="light"]`), not from eyeballing. Screenshots: `docs/design/torob/`.

| Screenshot | What |
|---|---|
| `search-360.png`, `search-360-cards.png`, `search-360-full.png` | search results, product grid |
| `product-360.png` | product header, variants, red buy box |
| `product-360-sellers-online.png` | "فروشنده‌ها" tabs, filter chips, online seller rows |
| `product-360-sellers-instore.png` | "خرید حضوری" in-store seller rows |
| `product-360-contact-sheet.png` | in-store "اطلاعات تماس" expanded panel |
| `store-360.png` | store (shop) info page |
| `search-1280.png`, `product-1280.png`, `store-1280.png` | desktop layouts |

## Color tokens (light theme)

Torob uses Tailwind slate under the name `sky-*`. Note the inverted naming: `--bg-bright` is the
grey page background, `--bg-fog` is the white surface.

| Torob token | Hex | Where seen |
|---|---|---|
| `--brand` | `#d73948` | "نمایش تمام N فروشگاه" link, store tab underline, buy gradient end |
| buy gradient | `linear-gradient(#f04151, #d73948)` | buy box, "خرید اینترنتی" button |
| `--logo-color-1` / `-2` | `#e91e33` / `#bf0f22` | logo, red search square |
| `--red-500` | `#d70040` | ghost button text+border ("خیر"), "راهنمای خرید امن" |
| `--sky-800` | `#1e293b` | primary text, prices, titles, icons, active tab bar, selected variant border |
| `--sky-500` | `#64748b` | muted text: city, store count, seller subtitle, English name, shipping fee |
| `--sky-300` | `#cbd5e1` | chip border, tab count badge bg |
| `--sky-100` / `--bg-bright` | `#f1f5f9` | page bg, search input bg, chips, badges, row dividers, section title bar |
| `--sky-50` | `#f8fafc` | secondary button bg |
| `--bg-fog` | `#ffffff` | cards, header, filter bar, bottom nav, seller section |
| `--blue-600` | `#3468cc` | "اطلاعات تماس", phone buttons, "مسیریابی" outline, installment link |
| `--btn-other-1st-color` | `linear-gradient(#3b75e5, #3468cc)` | blue filled buttons |
| `--blue-500` | `#3b82f6` | checkbox checked, links (store domain) |
| `--green-500` | `#4caf50` | "باز" (open now) |
| closed red | `#e02020` | "بسته" (closed now) |
| `--green-100` + text | `#daf2d5` / `#0b5124` | seller score pill "★۴.۳ (۷ سال در ترب)" |
| verified green | `#0cbc8d` | "بله" outline button in contact panel |
| `--yellow-500` | `#ffca32` | "آگهی" (ad) badge, text `#1e293b` |
| `--guarantee-800` | `#1c1c5d` | "ضمانت ترب" pill bg (text is a yellow->cyan gradient) |
| `--torobpay-primary` | `#773ca1` | Torob Pay; AI FAB uses `#7c3aed -> #9333ea` gradient |
| dark theme | `--sky-800 #f1f5f9`, `--bg-bright #15202b`, `--bg-fog #212b36`, `--brand #d74937` | `data-theme="dark"` |

## Typography

Font: `iranyekan` (static woff2, 400 and 700 only) on most UI; `IRANYekanX` variable font
(100-900) on newer widgets. Body 14px, color `#1e293b`. Only two weights are really used: 400 and 700.

| Element | Size / line-height | Weight | Color |
|---|---|---|---|
| Product title, PDP | 16 / 24 | 700 | `#1e293b` |
| Product title, grid card (h2) | 14 / 24, 3-line clamp | 700 | `#1e293b` |
| English model name, PDP | 12 | 400 | `#64748b` |
| Section title ("مشخصات", nearby stores) | 16 / 28 | 700 | `#1e293b` |
| Grid card price "از ... تومان" | 14 / 20 | 700 | `#1e293b` |
| Seller row price | 16 / 28 | 700 | `#1e293b` |
| Buy box seller line / price | 16 / 28 | 700 | `#ffffff` |
| Seller (shop) name | 16 / 28 | 700 | `#1e293b` |
| Seller city | 12 / 32 | 400 | `#64748b` |
| Seller offer title | 14 / 28 | 400 | `#1e293b` (wraps 2 lines) |
| Seller subtitle (warranty, shipping notes) | 12 / 24 | 400 | `#64748b` |
| Meta: "در ۷۴ فروشگاه", shipping fee | 12 / 24 | 400 | `#64748b` |
| Badge / pill text | 12 / 20 | 400 (700 for guarantee) | `#1e293b` |
| Buttons | 14, line 35-40 | 700 | white or brand |
| Bottom nav label | 11 | 700 | `#1e293b` |
| Search input | 16 | 400 | `#1e293b` |

## Price format

- Persian digits (U+06F0-U+06F9) everywhere, including counts and times: `۴۷۷`, `۱۰:۳۰`.
- Thousands separator is U+066B ARABIC DECIMAL SEPARATOR `٫` (renders like a slash), not a comma:
  `۶۵٫۹۸۰٫۰۰۰ تومان`. Codepoints: `6f6 6f5 66b 6f9 6f8 6f0 66b 6f0 6f0 6f0 20 62a 648 645 627 646`.
- Unit `تومان` after the number, one plain space, same size and weight as the number (single text node).
- Lowest-of-many: prefix `از `: `از ۱۵۶٫۹۵۶٫۰۰۰ تومان`. Single seller: no prefix, and the meta line
  names the shop: `در قطعه موبایل شاپ` instead of `در ۳ فروشگاه`.
- No range form ("X تا Y") is used; ranges are always "از X".
- Unavailable: price replaced by the word `ناموجود` (12px, 400, `#1e293b`) and the tile goes to
  the grey surface `#f1f5f9`, no strike-through, no red.
- Model / spec numbers in product names stay Latin ("A17 4G | حافظه 128 رم 4"); prices never do.
- Condition tag `کارکرده` sits between title and price on used items.
- Last-update time: not shown anywhere on mobile search, PDP or seller rows. Recency is signalled
  instead by tenure ("۲ سال در ترب") and opening hours ("بسته (تا ۱۰:۳۰ فردا)", "باز (تا ۲۳:۴۵)").

## Card and row anatomy

Search grid: page bg `#f1f5f9`, 8px outer gutter (cards area 344px), 2 columns, 8px gap.

```
+---------------------------+  bg #fff, radius 16, NO border, NO shadow
| [آگهی]            (6px)  |  padding 6 6 70 (bottom reserved for meta row)
| +-----------------------+ |
| |  image 156x156 r8     | |  image-search camera chip bottom-left, dots pager below
| +-----------------------+ |
| گوشی سامسونگ A17 4G |    |  14/24 bold, 3 lines
| حافظه 128 رم 4 گیگابایت   |
| از ۶۰٫۵۰۰٫۰۰۰ تومان       |  14/20 bold
| در ۱۴۱ فروشگاه     ♡  🔔  |  12 muted; heart + bell outline icons on the left
+---------------------------+
```

Online seller row (full-bleed white, separated by 1px `#f1f5f9` inset ring, padding 16):

```
| [گزارش ⚑]  [آگهی 📣]                 تپسی شاپ  |  name 16 bold; ad pill yellow r16
|                       تهران، تجارت هوشمند فاخر |  city 12 muted
|                  [ ⌄ بازارگاه (۲ سال در ترب) ] |  score pill #daf2d5 / #0b5124, r16
| گوشی موبایل سامسونگ A17 4G ... مشکی           |  offer title 14
| همراه گارانتی | تحویل زیر 2 ساعت ...           |  12 muted
|                           [ ⌄ تحویل فوری 🛒 ]  |  grey pill #f1f5f9 r16, 12px
| [ خرید اینترنتی ]           ۶۵٫۹۸۰٫۰۰۰ تومان  |  red gradient btn r8 h40; price 16 bold
|                       [ ⌄ خرید اقساطی با وام ] |  grey pill; or "هزینه ارسال رایگان" 12 muted
```

In-store ("حضوری") seller row, same container:

```
| [گزارش]                     📍تهران  سام موبو  |
| +-----------+   📍 خیابان جمهوری، خیابان...   |  address 14/28, 2-line clamp
| | shop photo|   🕒 بسته (تا ۱۰:۳۰ فردا) ⌄     |  بسته #e02020 / باز #4caf50
| | 132x144 r8|                                 |  photo-count chip #64748b r4 top-left
| +-----------+               [ ارسال فوری 🛒 ] |
| گارانتی ۱۸ ماهه شرکتی ...                      |  12 muted
| [ اطلاعات تماس ⌄ ]           ۵۳٫۴۰۰٫۰۰۰ تومان |  blue gradient btn r8 h40
```

"اطلاعات تماس" expands inline (no bottom sheet): panel `#f1f5f9`, radius 20, padding 12, a 2x2 grid
of 32px buttons, radius 8: phone numbers filled `#3468cc`, "مسیریابی" outlined `#3468cc`, "بله"
(verified) outlined `#0cbc8d`.

PDP buy box: full-width red gradient block, radius 8, padding 8 24 8 16, height 72: two lines
"خرید از {shop}" + price (white, 16 bold), with the navy "ضمانت ترب" pill (r12) on the left.

## Controls

- Header: white, 64px, bottom 1px `#f1f5f9` (box-shadow, not border). Search field `#f1f5f9`,
  radius 8, height 40, red logo square on the right, mic and camera icons on the left with a thin
  divider.
- Filter bar (search, sticky above bottom nav): white, 48px, inset top line `#f1f5f9`; items are
  plain text 14px with a chevron, no chip outline.
- Suggestion chips ("a16"): `#f1f5f9`, radius 8, padding 4 12, 14px, no border.
- Seller filter chips (PDP): white, radius 16, 0.8px `#cbd5e1` border, padding 4 12, two lines
  (title 12 bold + "از ... تومان" 12). Active: border `#1e293b` plus a small close x.
- Tabs ("خرید اینترنتی ۴۷۷ / خرید حضوری ۵۷"): 52px, 14px 400, count in a `#cbd5e1` r6 badge, a
  colored pin icon before the label; active = 4px `#1e293b` bar under the tab (store page uses a
  brand-red bar instead).
- Variant tiles: white, radius 8, padding 8; selected = 1.6px `#1e293b` border; unavailable = grey bg.
- Secondary button: `#f8fafc`, 0.8px `#f1f5f9` border, radius 6, muted text. Ghost danger:
  `#f8fafc` bg, 0.8px `#d70040` border and text, radius 8.
- Bottom nav: white, 56px + safe area, top 0.8px `#f1f5f9`, 4 items (جستجو، دسته‌بندی، پیشنهاد
  ویژه، ترب من), 24px outline icons in `#1e293b`, 11px bold labels.
- Icons: outline, ~1.5-2px stroke, rounded caps, single color `#1e293b` or `#64748b`; the only
  colored icons are the red/blue pins on tabs and the Torob Pay / guarantee marks.

## Signature details

1. Grey `#f1f5f9` canvas with white flat surfaces; depth comes from color, never from shadows.
2. Slate text (`#1e293b` / `#64748b`), not black; red is reserved for buying and the brand.
3. Red buy actions use a vertical gradient `#f04151 -> #d73948`; blue contact actions use
   `#3b75e5 -> #3468cc`. Both radius 8, height 40, bold 14px.
4. Persian digits with `٫` grouping and "از X تومان" for the lowest price.
5. Pills with radius 16 on `#f1f5f9` for every attribute (delivery, installments, ad, score),
   each with a small chevron when expandable.
6. Seller rows are full-bleed lists split by 1px hairlines, not floating cards; product results are
   r16 cards.
7. Price sits on the right of the purchase row, CTA on the left (RTL), same baseline.
8. Trust signals in words: tenure "(۷ سال در ترب)", star score "★۴.۳", "ضمانت ترب", opening hours.
9. iranyekan at 12/14/16 only, weights 400/700; meta lines get generous line-height (24-32px).
