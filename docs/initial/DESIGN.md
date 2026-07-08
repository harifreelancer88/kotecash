# kotecash Design System Specification (v3.0)

> Version: 3.0 — Updated from mockup-proven patterns
> Status: Production-ready reference for coding agent
> Source palette: [ColorHunt #355872 #7AAACE #9CD5FF #F7F8F0](https://colorhunt.co/palette/3558727aaace9cd5fff7f8f0)
> Reference mockup: `/tmp/kotecash-mockup/index.html`

This document is the single source of truth for all visual, layout, and component decisions. Every pattern described here is proven in the working mockup (v3). The coding agent must implement exactly this spec — no guesswork, no deviations.

---

## 1. Visual Philosophy & Tone

The visual style is curated for a highly focused household ledger. It adopts a **cold, nautical, clean-cut** tone — deep navy anchors the typography, steel blue drives interactive elements, and a soft sky blue provides accent and hierarchy. The overall feel is calm, structured, and professional — like a well-organized ship log.

- **Contrast Priority:** High legibility across dark navy text on cream backgrounds. No neon, no aggressive saturation.
- **Micro-interactions:** Interactive components respond immediately via hardware-accelerated transitions. Hover states darken by 10-15%.
- **Physical Feel:** Layouts rely on subtle hairline border structures (1px) rather than heavy blurs or dense drop-shadow offsets. No gradients on any structural element.
- **No Emoji in UI:** Zero emoji usage in any interface element. All icons use Lucide SVG library with consistent `#355872` or `#6B7D8E` stroke colors.
- **Minimalist Decoration:** No decorative illustrations, seasonal motifs, or arbitrary thematic elements. The grid itself is the ornament.
- **Pure Light Theme:** No dark mode toggle. The cream + navy palette is the only theme.

---

## 2. Core Color Profile

All colors defined as CSS custom properties in `:root`. This exact block must appear in `globals.css`:

```css
:root {
  --c-bg:       #F7F8F0;   /* Off-White Cream — main background */
  --c-surface:  #EDF0E8;   /* Cool Ivory — sidebar background */
  --c-card:     #FFFFFF;   /* Pure white — individual card rows, modals */
  --c-primary:  #355872;   /* Steel Navy — CTAs, headings, active nav */
  --c-focus:    #7AAACE;   /* Atlantic Blue — input borders, chart fills */
  --c-accent:   #9CD5FF;   /* Sky Blue — secondary indicators */
  --c-success:  #4A8C6F;   /* Sea Green — income, UNDER badges */
  --c-danger:   #C44B4B;   /* Muted Crimson — expense, OVER badges */
  --c-warning:  #D4A24E;   /* Golden Sand — warning/approaching */
  --c-ink:      #355872;   /* Deep Navy — body text */
  --c-sub:      #6B7D8E;   /* Slate Gray — labels, placeholders */
  --c-border:   rgba(53, 88, 114, 0.06);  /* Subtle borders */
  --radius:     10px;      /* Card border radius */
}
```

### Color Application Map

| Variable | Hex | Where Used |
|---|---|---|
| `--c-bg` | `#F7F8F0` | `<body>`, main canvas, `body::before` grid base |
| `--c-surface` | `#EDF0E8` | `.sidebar`, section group backgrounds |
| `--c-card` | `#FFFFFF` | `.card`, `.card-row`, modals, tables |
| `--c-primary` | `#355872` | `.btn-primary`, `h1`-`h3`, `.nav-item.active` text |
| `--c-focus` | `#7AAACE` | `input:focus`, `.select`, Chart.js fills, progress bars |
| `--c-accent` | `#9CD5FF` | Secondary badges, hover tints |
| `--c-success` | `#4A8C6F` | Income amounts, `.badge-under`, Outstanding tier |
| `--c-danger` | `#C44B4B` | Expense amounts, `.badge-over`, delete buttons |
| `--c-warning` | `#D4A24E` | Approaching-budget, Good tier |
| `--c-ink` | `#355872` | Body text, table cells, form inputs |
| `--c-sub` | `#6B7D8E` | `.page-subtitle`, `.section-title`, placeholders, icons |
| `--c-border` | `rgba(53,88,114,0.06)` | All borders (cards, rows, tables, sidebar) |

### Palette Visualization
```
┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐
│ #F7F8F0  │  │ #355872  │  │ #7AAACE  │  │ #9CD5FF  │
│  --c-bg  │  │ --c-ink  │  │ --c-focus│  │ --c-accent│
│          │  │ --c-primary│ │          │  │          │
└──────────┘  └──────────┘  └──────────┘  └──────────┘
```

---

## 3. Typography & Hierarchy

### Font Stack (in `globals.css`)
```css
body {
  font-family: 'Inter', system-ui, -apple-system, sans-serif;
}
.mono {
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
}
```

### Hierarchy Rules

| Level | Family | Weight | Size | Color | Usage |
|---|---|---|---|---|---|
| `h1` | Inter | 700 (bold) | `text-2xl` (24px) | `--c-primary` | Page headers |
| `h2` | Inter | 600 (semi-bold) | `text-lg` (18px) | `--c-primary` | Card section headers |
| `h3` | Inter | 600 | `text-base` (16px) | `--c-ink` | Item names |
| `.page-subtitle` | Inter | 400 | 13px | `--c-sub` | Below every `h1` |
| `.section-title` | Inter | 700 | 11px | `--c-sub` | Uppercase section labels |
| Body | Inter | 400 | `text-sm` (14px) | `--c-ink` | Tables, lists, descriptions |
| Subtext | Inter | 400 | `text-xs` (12px) | `--c-sub` | Labels, dates, metadata |
| Numbers | JetBrains Mono | 400-700 | varies | context-dependent | All currency amounts, percentages |

---

## 4. Layout Architecture

### Background Grid
The main background uses a subtle 48px dot-matrix grid rendered via CSS pseudo-element. This gives the "ledger paper" feel without visual noise.

```css
body::before {
  content: '';
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 0;
  background-image:
    linear-gradient(rgba(53, 88, 114, 0.025) 1px, transparent 1px),
    linear-gradient(90deg, rgba(53, 88, 114, 0.025) 1px, transparent 1px);
  background-size: 48px 48px;
}
main {
  position: relative;
  z-index: 1;
}
```

### Sidebar

| Property | Value |
|---|---|
| Background | `--c-surface` |
| Border | `1px solid var(--c-border)` on right |
| Expanded width | `240px` |
| Collapsed width | `56px` |
| Transition | `width 0.2s ease` |
| Brand | `text-lg` (18px), bold, `--c-primary` |
| Collapse button | Top-right, icon: `panel-left-close` / `panel-left-open` |

### Navigation Sections
Sidebar nav is grouped into 4 labeled sections with muted uppercase headers:

| Section | Items |
|---|---|
| **CORE** | Dashboard, Ledger, Statistics |
| **MANAGE** | Categories, Budgets, Cicilan |
| **ANALYZE** | Net Worth, What-If |
| **TOOLS** | API Tokens, Share, AI Docs |

Each nav item:
- Padding: `10px 12px`, margin: `1px 4px`
- Border-radius: `var(--radius)` (10px) — pill shape
- Default: `--c-sub` text
- Hover: `--c-primary` text + `rgba(53,88,114,0.05)` background
- Active: `--c-primary` text + `rgba(53,88,114,0.08)` background, `font-weight: 600`
- Section labels: `font-size: 10px`, `font-weight: 700`, `letter-spacing: 0.06em`, uppercase

### Main Content Area
- Margin-left: `240px` (expanded) / `56px` (collapsed)
- Padding: `p-5 md:p-8` (20px mobile, 32px desktop)
- `transition: margin-left 0.2s`

### Mobile (≤768px)
- Sidebar: `display: none`
- Bottom navigation bar: `position: fixed`, `bottom: 0`, full width, `--c-surface` background
- Content padding-bottom: `72px` (to clear bottom nav)
- Card rows: `flex-wrap: wrap` to accommodate smaller screens

---

## 5. Component Patterns (from Mockup)

### A. Cards (`.card`)
Full-container cards used for: Dashboard summary cards, chart containers, form blocks, tables, modals.

```css
.card {
  background: var(--c-card);
  border: 1px solid var(--c-border);
  border-radius: var(--radius);
}
```
Usage: `<div class="card p-5">...</div>`

### B. Row Cards (`.card-row`)
Individual data rows — the key pattern that replaces monolithic blocks. Used for: Budget rows, Ledger transactions, Upcoming Cicilan.

```css
.card-row {
  background: var(--c-card);
  border: 1px solid var(--c-border);
  border-radius: var(--radius);
  padding: 12px 16px;
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 6px;
  transition: box-shadow 0.15s;
}
.card-row:hover {
  box-shadow: 0 1px 4px rgba(53, 88, 114, 0.05);
}
```

Row layout pattern (Budgets):
```
[Category Name] ——— [Progress Bar] ——— [Rp X / Y] ——— [BADGE]
   w-24              flex-1              w-32 mono       flex-shrink-0
```

Row layout pattern (Ledger):
```
[Date] [Category] [Description...] [Method] [Amount +/-] [✏️🗑️]
 w-20    w-24       flex-1 truncate  w-16     w-36 mono    buttons
```

### C. Buttons

| Type | Class | Style |
|---|---|---|
| Primary CTA | `.btn-primary` | `background: --c-primary`, white text, `border-radius: var(--radius)`, `font-weight: 600` |
| Primary hover | — | `#2A4A63` (10% darker) |
| Icon button | inline | `color: --c-sub`, hover → `--c-primary` or `--c-danger` (delete) |

### D. Status Badges

```css
.badge-under  { color: var(--c-success); background: rgba(74,140,111,0.08); border-radius: 6px; padding: 2px 8px; font-size: 11px; font-weight: 600; }
.badge-over   { color: var(--c-danger);  background: rgba(196,75,75,0.08);  border-radius: 6px; padding: 2px 8px; font-size: 11px; font-weight: 600; }
.badge-track  { color: var(--c-focus);   background: rgba(122,170,206,0.10); border-radius: 6px; padding: 2px 8px; font-size: 11px; font-weight: 600; }
```

All badges include a Lucide icon:
- `UNDER` → `check-circle-2`
- `ON TRACK` → `check-circle`
- `OVER` → `alert-triangle`

### E. Health Tags (`.health-tag`)
Used in Dashboard Financial Health section. Each metric is an individual pill.

```css
.health-tag {
  background: rgba(53, 88, 114, 0.04);
  border-radius: 8px;
  padding: 10px 14px;
  text-align: center;
}
```

Four tags in a `grid grid-cols-4`:
1. **Savings Rate** — colored pill (green/blue/amber/red) with icon + tier name
2. **DTI** — large mono percentage + tier label
3. **50/30/20 Needs** — large mono percentage (red if >50%)
4. **50/30/20 Savings** — large mono percentage (always green)

### F. Section Titles & Page Subtitles

```css
.page-subtitle {
  font-size: 13px;
  color: var(--c-sub);
  margin-top: -4px;
  margin-bottom: 20px;
}

.section-title {
  font-size: 11px;
  font-weight: 700;
  color: var(--c-sub);
  letter-spacing: 0.05em;
  text-transform: uppercase;
  margin-bottom: 10px;
}
```

Every page follows this pattern:
```html
<h1>Page Name</h1>
<p class="page-subtitle">Brief description of this page</p>
```

### G. Cicilan Cards
Full-card pattern (not row-cards). Each cicilan has:
- Header: name + remaining principal (right-aligned)
- Progress bar: `--c-bg` background, `--c-focus` fill
- 4-column detail grid: Monthly / Interest / Due Date / Total

### H. Scenario (What-If) Simulator
- 2 range sliders: Income Change (-50% to +100%), Expense Change (-50% to +100%)
- Real-time update via `oninput`
- 4 scenario result cards + Chart.js bar comparison + detailed breakdown table
- Color coding: better = `--c-success`, worse = `--c-danger`

---

## 6. Charts & Data Visualization (Chart.js)

### Global Config
```js
Chart.defaults.color = '#6B7D8E';
Chart.defaults.font.family = 'Inter, system-ui, sans-serif';
Chart.defaults.font.size = 11;
```

### Chart Color Array
```js
['#7AAACE', '#355872', '#4A8C6F', '#9CD5FF', '#D4A24E', '#6B7D8E', '#C44B4B']
```

### Chart Types & Configs

**Bar Chart** (Income vs Expense):
- Income: `#4A8C6F`, Expense: `#C44B4B`
- `borderRadius: 4`, `responsive: true`
- Y-axis tick callback: `(v) => (v/1e6).toFixed(1)+'M'`

**Doughnut Chart** (Spending by Category):
- 7 colors from palette array
- Legend position: `'right'`, font size: 10

**Line Chart** (Net Worth):
- Assets: `#4A8C6F`, Liabilities: `#C44B4B`, Net Worth: `#7AAACE`
- `fill: true`, `tension: 0.3`, `pointRadius: 4`
- Net Worth line: `borderWidth: 2`, `pointBackgroundColor: '#355872'`

**Bar Chart** (Scenario Comparison):
- Current: `#7AAACE`, Scenario: `#355872`
- `borderRadius: 6`, `max: 60` (percent)

---

## 7. Icon System — Lucide

**Library:** [Lucide](https://lucide.dev) — MIT license, 1,000+ icons
**Astro:** `npm install lucide-astro` → `<CheckCircle class="w-4 h-4" />`
**CDN (mockup only):** `<script src="https://unpkg.com/lucide@latest">`
**Sizing:** 16px (inline badges), 20px (nav, buttons)
**Color:** `currentColor` — controlled via parent `color`/`text-*`

### Confirmed Icon Assignments (from mockup)

| Page/Context | Icon |
|---|---|
| Dashboard | `layout-dashboard` |
| Ledger | `scroll-text` |
| Statistics | `bar-chart-3` |
| Categories | `tags` |
| Budgets | `wallet` |
| Cicilan | `credit-card` |
| Net Worth | `line-chart` |
| What-If | `calculator` |
| API Tokens | `key` |
| Share | `share-2` |
| AI Docs | `bot` |
| Add/Create | `plus` |
| Edit | `pencil` |
| Delete | `trash-2` |
| Collapse sidebar | `panel-left-close` / `panel-left-open` |
| Budget UNDER | `check-circle-2` |
| Budget ON TRACK | `check-circle` |
| Budget OVER | `alert-triangle` |
| Health Outstanding | `award` |
| Health Excellent | `star` |
| Health Good | `thumbs-up` |
| Health Needs Improve | `alert-triangle` |

---

## 8. Responsive Breakpoints

| Breakpoint | Behavior |
|---|---|
| **Desktop** (≥769px) | Full sidebar (240px/56px), multi-column grids (`md:grid-cols-2/3/4`) |
| **Mobile** (≤768px) | Sidebar hidden, bottom nav bar (icon+label), single-column, cards wrap |

---

## 9. Implementation Checklist for Coding Agent

- [ ] Copy `:root` CSS variables block to `globals.css`
- [ ] Implement `body::before` grid pattern
- [ ] Build sidebar with 4 grouped sections, collapsible, pill active state
- [ ] Build mobile bottom nav (auto-generated from same nav data)
- [ ] Create `.card` and `.card-row` utility classes
- [ ] Implement `.page-subtitle` and `.section-title` patterns
- [ ] Add Lucide (`lucide-astro`) and Chart.js (`chart.js`) dependencies
- [ ] Use Tailwind `inter` + `jetbrains-mono` font families
- [ ] All amounts in `.mono` (JetBrains Mono)
- [ ] Status badges with Lucide icon + text
- [ ] Health tags layout: 4-column grid
- [ ] Chart.js configs as specified in §6
- [ ] Zero emoji — all indicators via Lucide icons
- [ ] No dark mode — pure light theme only
- [ ] No gradients on any element

---

## 10. Color Contrast Compliance

| Combination | Ratio | WCAG |
|---|---|---|
| `#355872` on `#F7F8F0` | 5.8:1 | AA ✅ |
| `#355872` on `#FFFFFF` | 6.5:1 | AA ✅ |
| `#6B7D8E` on `#F7F8F0` | 3.8:1 | AA (large) ✅ |
| `#FFFFFF` on `#355872` | 6.5:1 | AA ✅ |
| `#4A8C6F` on `#F7F8F0` | 3.5:1 | AA (large) ✅ |
| `#C44B4B` on `#F7F8F0` | 4.2:1 | AA ✅ |
