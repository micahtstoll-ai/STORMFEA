# STORMFEA Design System

Engineering software for FDM structural analysis. Built by Nordic Storm FTC 5962.
Every element has a specific job. When two elements look the same, that's slop.

---

## Typography

Three fonts, strict roles. Never mix roles.

| Font | Weight | Role |
|---|---|---|
| **Rajdhani** | 700 | Structural headings, section landmarks, tab labels, panel titles |
| **Outfit** | 400/500/600 | All UI copy — button labels, form labels, descriptions, body text |
| **DM Mono** | 300/400/500 | All data — numbers, measurements, code, status values, coordinates |

**Never use:** Inter, Roboto, Arial, system-ui as primary font. `system-ui` only appears as last-resort fallback after a named font.

### Type Scale (4 sizes only)

```css
--text-xs:   9px;   /* data labels, secondary hints, metadata */
--text-sm:  11px;   /* primary UI text, form labels, button copy */
--text-base: 13px;  /* body, descriptions */
--text-lg:  16px;   /* major headings, display values */
```

Do not use 10px, 12px, or 14px. If something looks too large at 11px, it should probably be 9px.

---

## Colour

Three colours, two dimensions. No others.

**Accent:** `--gold` (amber `#F5A623` or classic gold `#C9A227`, user-selectable)
**Base:** `--bg-base` through `--bg-input` (four steps, dark or light)
**Text:** `--text-hi` / `--text-mid` / `--text-lo` / `--text-label` (four steps)

**Semantic only:**
- `--warn` — amber/orange, not yellow
- `--danger` — rust red, not pure red
- `--success` — always `var(--gold)`, never green

**Never use:** purple, cyan, blue, green, or any gradient. No `box-shadow: 0 2px 8px rgba(0,0,0,.1)` (the generic shadow). Use specific shadow values with intention.

---

## Spacing

Four values, used consistently.

```css
--sp-1:  6px;   /* tight: icon gap, badge padding, thin separators */
--sp-2: 12px;   /* standard: within-group margins, compact card padding */
--sp-3: 20px;   /* section: between-group margins, tab content side padding */
--sp-4: 32px;   /* major: between sections, large breathing room */
```

Tab content uses `--sp-3` left/right, `--sp-2` top. Not hardcoded 22px.

---

## Border Radius

Three values, tied to element type.

| Value | Use |
|---|---|
| `0` | Toolbar buttons, tab nav, header elements — instrument panel parts don't curve |
| `2px` | Inline chips, badges, small status indicators |
| `4px` | Cards, inputs, dropdowns, popup panels |

Never put `border-radius:4px` on a toolbar button or tab. Never put `0` on a card.

---

## Motion

Two speeds only.

```css
--t-fast:  80ms;   /* hover: border-color, color — immediate feedback */
--t-slow: 220ms;   /* structural: panel open/close, card fade-in */
```

No uniform transition catch-all. Background-color on `html`/`body` (theme switch): no transition, instant.

**Keyframes:**
- `fadeIn` — `opacity 0→1, translateY(6px→0)` — for cards appearing
- `pulse` — `opacity 1→0.2→1` at 1.6s — for loading state (deeper dip, slower)
- `spin-slow` — `rotate(0→360deg)` at 12s linear — for idle compass in dropzone

---

## Component Rules

### Tab Navigation
- No border-radius
- Active state: `border-top: 2px solid var(--gold)` — top line only, not filled box
- Workflow tabs (SETUP→RESULTS): 9px Rajdhani, 0.12em letter-spacing
- Utility tabs (CALIBRATE, SOURCES, DEBUG): separated by a vertical rule, `var(--text-lo)` color

### Buttons (three tiers)
- **Tier 1 Primary** (Analyse, Add Bolt, Import): gold background, `10px 20px` padding, 11px Outfit 600, 0.06em letter-spacing
- **Tier 2 Secondary** (active tool modes, active toggles): gold border + text, transparent background
- **Tier 3 Ghost** (Cancel, Start New, undo/redo, utility): `var(--border)` border, `var(--text-lo)` text, hover lifts to `var(--text-mid)`
- Toolbar buttons: `border-radius:0`, bottom-border active indicator (not background fill)

### Cards (three types)
- **Data-display** (results, file info, orientation readout): `border-left: 2px solid var(--gold)`, `bg-input` background, `10px 14px` padding
- **Control** (popups, preference panels): standard `border:1px solid var(--border)`, `border-top` slightly heavier, `bg-panel` background
- **Status/callout** (empty states, hints, notes): no card box — `border-left: 2px solid var(--border)`, `padding-left: 10px`, no background

### Section Headings
- **Section landmarks** (tab h2s): Rajdhani 13px, 0.12em letter-spacing, `var(--text-mid)`
- **Within-section labels** (STEP 1, QUICK PRESETS, BED FACE): Outfit 11px, 0.06em letter-spacing, `var(--text-label)`
- **Data labels** (SAFETY FACTOR, PEAK STRESS): DM Mono 9px, 0.08em letter-spacing, `var(--text-lo)`

### Dropzone (empty state)
- Edge-to-edge (no 16px margin box)
- Rotating compass SVG at 30% gold opacity, 12s/rev; speeds to 3s on hover
- Copy: "LOAD PART" in Rajdhani 22px, 0.1em, `var(--text-lo)`. Below: "drag & drop · .stl · .step" in DM Mono 10px

### CTA Buttons (next-step)
- Copy: "Next: [Tab Name] →" not "Continue ->"
- Rajdhani 11px, 0.08em letter-spacing
- Flush-bottom tab footer: edge-to-edge `bg-panel`, `--sp-3` padding

### Workflow Timeline
- Vertical timeline with circle indicators, not numbered text list
- Completed: filled gold circle + gold line; Active: outlined gold + pulse; Upcoming: `var(--border)`
- No numbered prefixes

---

## What This Is Not

- Not a marketing site — no gradients, no hero sections, no decorative illustrations
- Not a generic dashboard — no Inter, no card grids, no purple accent
- Not a form wizard — the workflow steps are a physical process (3D printing), not a software form

The aesthetic reference is precision instrument panels and engineering printouts: warm, measured, purposeful.
