# STORMFEA Design System

Engineering software for FDM structural analysis. Built by Nordic Storm FTC 5962.
Every element has a specific job. When two elements look the same, that's slop.

## How to use this file

`client/index.html` is a single ~15,000-line file with **no CSS framework and no
linter enforcing any of this**. The rules below are held by people and agents
reading them, and nothing else. Two consequences:

- **Copy the rule, not the neighbouring line.** The file contains pre-existing
  drift from these rules. A value you find next to the code you are editing is
  not evidence that the value is sanctioned.
- **Reach for a token, never a literal.** Every rule here is expressed as a CSS
  custom property defined in the `:root` blocks at the top of the file. If a
  design decision needs a number that is not already a token, that is a signal
  to reconsider the decision, not to hardcode the number.

The section [Reviewing a UI diff](#reviewing-a-ui-diff) at the end is the
checkable form of everything above it.

---

## Typography

Three fonts, strict roles. Never mix roles. All three are vendored under
`client/vendor/fonts/` as `@font-face` sources — the app must work with no
network, so never add a Google Fonts or CDN link.

| Font | Weights shipped | Role |
|---|---|---|
| **Rajdhani** | 700 | Structural headings, section landmarks, tab labels, panel titles |
| **Outfit** | variable (use 400/500/600) | All UI copy — button labels, form labels, descriptions, body text |
| **DM Mono** | 300/400/500 (+300 italic) | All data — numbers, measurements, code, status values, coordinates |

**Never use:** Inter, Roboto, Arial, Fira Code, Courier New, or a bare
`monospace` / `sans-serif` as the primary family. `system-ui`, `sans-serif` and
`monospace` appear only as the last-resort fallback after a named font.

The rule "all data is DM Mono" is not cosmetic. A number rendered in a
proportional face changes width as it changes value, so a live readout jitters
and columns of figures stop aligning. Anything that updates during a solve is
data.

### Type scale (5 sizes)

```css
--text-xs:   9px;   /* data labels, secondary hints, metadata */
--text-sm:  10px;   /* data values, legend labels, dense secondary copy */
--text-md:  11px;   /* primary UI text, form labels, button copy */
--text-base: 13px;  /* body, descriptions */
--text-lg:  16px;   /* major headings, display values */
```

Do not use 7, 8, 8.5, 10.5, 12, 14, 18, 22, 32 or 36px. **10px is reserved
for numeric data and secondary UI that sits awkwardly between 9px and 11px**—
convergence-study blocks, legend value labels, and dense copy tables use it
consistently. If something looks too large at 11px, it should probably be 9px.
Use the token, not the literal: `font-size: var(--text-sm)`, never
`font-size: 10px`.

The one deliberate exception is the landing/splash screen, which is a full-bleed
brand moment rather than instrument-panel chrome and carries its own `--sf-*`
palette (below). It still uses the three fonts.

---

## Colour

Three colours, two dimensions. No others.

### The tokens that exist

**Accent — one canonical gold.** `--gold` is `#C9A227`, matched to the ship and
lightning in the Nordic Storm brand mark. It is *not* user-selectable; there is
no amber alternative. Every other gold derives from it, so the brand stays
consistent across light and dark:

| Token | Use |
|---|---|
| `--gold` | The accent itself: active state, primary button fill, data-card rule |
| `--gold-bright` | Hover on a gold-filled surface only |
| `--gold-dim` | Gold on a light/print background, and secondary gold copy |
| `--gold-glow` | Gold at low alpha for borders and focus rings |
| `--gold-faint` | Gold at very low alpha for active-row / active-tab wash |
| `--accent-dim` | Gold tint for large fills, defined per theme |

**Base — four steps plus two borders.** `--bg-base` · `--bg-panel` · `--bg-card`
· `--bg-input`, with `--border` and `--border-mid` for the one- and two-step
separators, `--viewer-bg` for the 3-D canvas, and `--shadow` for the single
sanctioned elevation. Every one is redefined for light theme.

**Text — four steps.** `--text-hi` · `--text-mid` · `--text-lo` ·
`--text-label`. These are meant to be four *distinguishable* steps; if a new
value would land within a few percent of an existing one, the scale has three
steps and the fourth is decoration.

**Semantic — three, and only for meaning:**

| Token | Value | Meaning |
|---|---|---|
| `--warn` (+ `--warn-faint`, `--warn-glow`) | amber/orange, not yellow | A caveat the reader must act on |
| `--danger` (+ `--danger-faint`) | rust red, not pure red | A failure or a blocking condition |
| `--success` | **always `var(--gold)`** | Pass / complete |

`--success` is gold and **never green**, in the UI chrome, in a canvas-rendered
report page, and in a print stylesheet alike. A green "safe" badge is the single
easiest way to make a 1.9× safety factor read as reassurance, which is the exact
misreading this tool exists to prevent.

**Landing screen — `--sf-*`.** `--sf-bg`, `--sf-mid`, `--sf-accent`,
`--sf-highlight`, `--sf-text`, `--sf-text-lo`, `--sf-border`,
`--sf-rain-opacity`. These are a self-contained brand palette for the splash
screen and are not available to, or usable by, ordinary UI. The palette is
theme-aware: the `:root` values are the dark splash (`--sf-bg: #080603`), and a
`[data-theme="light"]` block redefines them for the light splash (#362).

The light-splash background is a **standard, not a free choice: `--sf-bg:
#f4eee2`** — a mid-cream that is deliberately warmer and a shade deeper than the
app chrome's `--bg-base` (#faf7f2), and **not** pure white. The falling "rain"
is gold (`--sf-accent`) drawn at `--sf-rain-opacity` (0.22 dark / 0.10 light);
on white or near-white the gold washes out and the rain disappears, so the cream
is what keeps it readable. Keep the two paired — if you lighten the background
toward white you must raise the rain opacity, and vice versa. The rest of the
light set: `--sf-mid: #ffffff` (nav cards), `--sf-highlight: #B0851A` (a gold
that stays legible on cream), `--sf-text: #1c1a16`, `--sf-text-lo: #7a7060`,
`--sf-border: rgba(176,133,26,0.30)`; `--sf-accent` stays `#C9A227` in both
themes.

### The rules

- **Never use** purple, cyan, blue, green, magenta, or teal in the chrome — as a
  literal, a named colour, or a token.
- **Never use a gradient** in the chrome. No decorative fades, no gold-to-
  transparent rules, no shimmer sweeps.
- **Never hardcode a hex literal** where a token exists. `#C9A227` in a style
  attribute is the same bug as `11px`: it silently opts that element out of the
  light theme, the high-contrast theme and the print stylesheet, all of which
  work by redefining tokens.
- **Never append an alpha suffix to a `var()`.** `color: var(--gold)88` is not
  a colour — substitution leaves `#C9A227` and `88` as two separate tokens, so
  the declaration is invalid and dropped, and the element silently inherits.
  Use `--gold-glow` / `--gold-faint`, or add a named token.
- **One shadow.** Use `var(--shadow)`. No `box-shadow: 0 2px 8px rgba(0,0,0,.1)`
  and no per-element ad-hoc elevation; if a surface needs to float, it needs
  `--shadow`, and if `--shadow` is wrong for it, the surface is wrong.

### Colour in the data plane vs the chrome

The rules above govern the **chrome**: panels, buttons, type, badges, borders.
They do not govern the **heatmap colormaps**, which are a different thing with a
different job.

The colormaps (`COLORMAPS` — viridis, plasma, rainbow — and `DIVERGING_BWR`, in
`client/index.html`) are perceptually-uniform scientific colour scales. Their
values are fixed by the published definitions and are not design choices: they
necessarily contain blue, green and purple, and a legend ramp is necessarily a
gradient. **Do not "fix" a colormap to match the chrome palette** — doing so
destroys the perceptual uniformity that makes the picture readable, and
viridis/plasma are the two colourblind-safe options a user can pick.

The boundary is exact and worth stating: a colormap value may only ever appear
inside the 3-D view, the legend ramp, the colormap picker swatches, and a cut
face. Everything else is chrome. In particular, do not sample a colormap for a
button, a badge, a chart axis, or a status dot.

---

## Colour space is correctness, not cosmetics

The model's colours **are** the reading. A facet painted the wrong colour is a
misreported stress, not a cosmetic blemish. Three rules bind anything that
touches the 3-D view; all three are locked by test group `[T]` in
`scripts/test_client_logic.mjs`, and the normative statement lives in
`CLAUDE.md`.

**1. sRGB for the browser, LINEAR for the GPU.** The `COLORMAPS` /
`DIVERGING_BWR` tables are sRGB — the space viridis and plasma are defined in,
and what CSS `rgb()` and canvas `fillStyle` expect. Three.js r152 defaults
`outputColorSpace = 'srgb'` with ColorManagement on, so the shader's working
space is linear-sRGB, and per Three's contract a vertex-colour
`BufferAttribute` is assumed to be **already linear** — it is never converted
for you.

| You are painting | Reach for |
|---|---|
| Anything the **browser** paints — a CSS `rgb()`, a canvas `fillStyle`, a legend swatch, a picker chip | `stressColor(t, map)` / `divergingColor(t)` |
| Any geometry **`color` attribute** handed to Three.js | `stressColorLinear(t, map)` / `divergingColorLinear(t)` |
| A filtered-out (greyed) vertex | `FILTER_GREY_LINEAR` |
| An unpainted / no-data mesh | `DEFAULT_MESH_LINEAR` |

Writing sRGB values straight into a `color` attribute applies a spurious ~1/2.2
brightening to the model while the legend stays correct, and no amount of gamma
tweaking afterwards can reconcile the two.

**2. The light rig sums to exactly 1.0 and is untinted white.** r152 defaults
`useLegacyLights = true`, so intensity is a raw multiplier with no 1/π falloff.
Over-unity lighting clips channels *independently*, which rotates hue rather
than merely brightening — the same stress then reads as a different colour
depending on which way a facet points, destroying the point of a perceptually
uniform colormap. A tinted light does the same thing more quietly. The rig in
`initThree` is ambient 0.55 + directional 0.30 + directional 0.15, all
`0xffffff`. Rebalance the three if you like; keep the sum at 1.0 and keep them
white.

**3. Data-carrying meshes are matte.** Build them with `makeStressMaterial()`
(specular `0x000000`, shininess 0, `flatShading: false`). Phong's specular term
is *additive*: a highlight lays a white sheen over the reading and can push a
unit-scale colour past 1.0, reintroducing the clipping rule 2 exists to prevent.
Never hand-roll a `MeshPhongMaterial` for a mesh that carries data, and never
set `flatShading: true` on a colour-attribute geometry — it produces hard edges
at triangle boundaries that read as artifacts in the data.

Together these bound the output at the colormap colour itself: a fully-lit facet
renders it exactly, and every other facet renders a darkened version of the
*right hue*. Shading reads the part's form; it cannot misreport a number.

---

## Spacing

Four values, used consistently.

```css
--sp-1:  6px;   /* tight: icon gap, badge padding, thin separators */
--sp-2: 12px;   /* standard: within-group margins, compact card padding */
--sp-3: 20px;   /* section: between-group margins, tab content side padding */
--sp-4: 32px;   /* major: between sections, large breathing room */
```

Use the token. `padding: var(--sp-3) var(--sp-3)` is right; `padding: 20px 20px`
is the same pixels and still wrong, because it will not move when the scale
does. Tab content uses `--sp-3` left/right and `--sp-2` top — not a hardcoded
22px.

There is no 4, 5, 8, 10, 14 or 16px step. If a gap wants 8px, it wants 6 or 12.

---

## Border Radius

Three values, tied to element type.

| Value | Use |
|---|---|
| `0` | Toolbar buttons, tab nav, header elements — instrument panel parts don't curve |
| `2px` | Inline chips, badges, small status indicators |
| `4px` | Cards, inputs, dropdowns, popup panels |
| `50%` | Circular status indicators only (workflow-timeline dots) — a shape, not a corner treatment |

There is no 1, 3, 5, 6, 8 or 20px radius. Never put `border-radius: 4px` on a
toolbar button or a tab; never put `0` on a card; never use a pill radius on a
header control.

---

## Motion

Two speeds only.

```css
--t-fast:  80ms;   /* hover: border-color, color — immediate feedback */
--t-slow: 220ms;   /* structural: panel open/close, card fade-in */
```

Name the properties you are transitioning. `transition: all .15s` is banned
twice over — it is a third speed, and a catch-all that animates properties you
did not mean to animate. Background-color on `html`/`body` (theme switch) has no
transition and is instant.

**Keyframes:**

| Name | Definition | Use |
|---|---|---|
| `fadeIn` | `opacity 0→1`, `translateY(6px→0)` | Cards appearing |
| `pulse` | `opacity 1→0.2→1`, **1.6s ease-in-out** | Loading / active-step state |
| `spin-slow` | `rotate(0→360deg)`, 12s linear | Idle compass in the dropzone; speeds to 3s on hover |
| `shimmer` | `background-position −200px → 200px` | Skeleton placeholder only. It implies a moving gradient, so it is confined to a loading skeleton and must never sit under content, a control, or a data surface. |

`pulse` runs at 1.6s. A faster pulse reads as an alarm rather than a
"working" state.

**Reduced motion.** The file honours `prefers-reduced-motion: reduce`, and
`prefersReducedMotion()` gates JS-driven animation (deflected-shape animation,
mode-shape playback). Any new animation must be reachable by one of those two
paths — a decorative animation with no reduced-motion path is not shippable.

---

## Component Rules

### Tab Navigation
- No border-radius
- Active state: `border-top: 2px solid var(--gold)` — a top line, plus at most
  the `--gold-faint` wash. Not a filled box.
- Workflow tabs (SETUP → RESULTS): `--text-xs` Rajdhani 700, 0.12em
  letter-spacing
- Utility tabs (PREFS, DBG): `--text-xs`, 0.08em, `var(--text-lo)`, separated
  from the workflow tabs by a 1px vertical rule. Receded by opacity and padding
  — never by dropping below the type scale.

### Buttons (three tiers)
- **Tier 1 Primary** (Analyse, Add Bolt, Import): gold background, `10px 20px`
  padding, `--text-sm` Outfit 600, 0.06em letter-spacing
- **Tier 2 Secondary** (active tool modes, active toggles): gold border + gold
  text, transparent background, `--gold-faint` fill when active
- **Tier 3 Ghost** (Cancel, Start New, undo/redo, utility): `var(--border)`
  border, `var(--text-lo)` text, hover lifts to `var(--text-mid)`
- Toolbar buttons: `border-radius: 0`, bottom-border active indicator, not a
  background fill
- Disabled is `opacity: 0.5` plus `cursor: not-allowed` — never a new colour

### Cards (three types)
- **Data-display** (results, file info, orientation readout): `border-left: 2px
  solid var(--gold)`, `--bg-input` background, `10px 14px` padding, `fadeIn`
- **Control** (popups, preference panels): `border: 1px solid var(--border)`,
  slightly heavier `border-top`, `--bg-panel` background
- **Status/callout** (empty states, hints, notes): no card box — `border-left:
  2px solid var(--border-mid)`, `padding-left: 10px`, no background

### Section Headings
- **Section landmarks** (tab h2s): Rajdhani `--text-base`, 0.12em
  letter-spacing, `var(--text-mid)`
- **Within-section labels** (STEP 1, QUICK PRESETS, BED FACE): Outfit
  `--text-sm`, 0.06em letter-spacing, `var(--text-label)`
- **Data labels** (SAFETY FACTOR, PEAK STRESS): DM Mono `--text-xs`, 0.08em
  letter-spacing, `var(--text-lo)`

### Dropzone (empty state)
- Edge-to-edge, no margin box
- Rotating compass SVG at ~30% gold opacity, 12s/rev; speeds to 3s on hover
- Copy: "LOAD PART" in Rajdhani 700, `var(--text-lo)`, 0.1em. Below it, the
  accepted extensions in DM Mono `--text-xs`: "drag & drop · .stl · .step ·
  .gcode". Keep that list in sync with the `accept` attribute on `#filein` —
  it is the only place a user learns `.gcode` import exists.

### CTA Buttons (next-step)
- Copy: "Next: [Tab Name] →", not "Continue ->"
- Rajdhani `--text-sm`, 0.08em letter-spacing
- Flush-bottom tab footer: edge-to-edge `--bg-panel`, `--sp-3` padding

### Workflow Timeline
- Vertical timeline with circle indicators, not a numbered text list
- Completed: filled gold circle + gold connector; Active: outlined gold +
  `pulse`; Upcoming: `var(--border-mid)`; Warning: `var(--warn)`
- No numbered prefixes
- The whole row is the click target, and it navigates to that step's tab

### Banners and badges (reliability, caveats)
- A caveat banner is `--warn`-bordered with a `--warn`-tinted fill; a blocking
  one is `--danger`. Both carry an inline SVG glyph, never an emoji and never a
  bare punctuation mark.
- Fill tints come from `--warn-faint` / `--danger-faint`, not a hand-mixed hex.
- A banner states what is uncertain and what to do about it. It is never
  dismissible in a way that survives a new analysis.

---

## Result-display rules

These are component rules where getting the visual wrong changes what the tool
claims. Treat them as part of the design system, not as solver concerns.

### The legend

- **The legend and the model always use the same scale.** `currentGamma()` is
  the single source of truth for the perceptual curve (γ = 0.55) and every paint
  path reads it, including the section cut face. Never keep a second copy of the
  gamma flag — the copy drifts the moment the toggle is used.
- **The LINEAR / γ toggle lives in the legend**, as a Tier-3 ghost button
  labelled with the state it will switch *to*. Its state persists in
  `localStorage` under `sf-gamma-disabled`; the `?disableGamma=true` URL flag
  only sets the initial value.
- **The sequential scale clips to p02..p98** so one singular vertex cannot wash
  out the map, and **that clip is reported, not silent**: the top and bottom
  legend labels take a `≥` / `≤` marker. The marker is stored on `S._legendClip`
  and re-applied by `refreshUnitsDisplay`, so a unit toggle cannot drop it.
  A legend that does not mark its own clipping overstates its coverage and
  disagrees with the MAX STRESS card.
- Legend numbers are DM Mono. The unit label follows the SI/imperial setting;
  never hardcode "MPa".

### View-mode buttons

- Every heatmap view mode is declared once, in `MODE_META` — legend title, hover
  label, unit, decimals, sequential-vs-diverging pipeline, and its source array.
  Adding a mode means adding a `MODE_META` entry and an id in `ALWAYS_MODES` or
  `OVERFLOW_MODES`, never a new bespoke paint path.
- Six always-visible modes lead the column; the rest sit behind the MORE toggle.
- Each button carries a short glyph (`Δ`, `σ₁`, `η`) plus a full caption, and a
  `title` that says what the mode *means* and what it does not claim.

### A mode that has no data must not appear

**Null means unmeasured, and must never render as zero.** The `meshsens` mode
needs two solved meshes to exist at all; with one solve, the button is not
shown, rather than shown painting zeros. `headlineSpread` follows the same rule.
A view that renders "no measurement" as "measured, and it's fine" is the worst
failure this UI can have. Locked by test group `[V]` in
`scripts/test_client_logic.mjs`.

### Uncertainty must say *where*

A "this value is uncertain" signal that is a single scalar on the RESULTS tab is
invisible to someone reading the 3-D view, which is where the reading actually
happens. Any new uncertainty signal should be paintable per location, or should
explain in its `title` why it cannot be.

---

## Themes, contrast and print

The token layer is what makes these work, which is why hardcoded literals are a
correctness bug and not a style nit. Four presentations share one set of rules:

- **Dark** (`:root`, `[data-theme="dark"]`) — black page, warm-tinted text
- **Light** (`[data-theme="light"]`) — warm off-white page, near-black text
- **High contrast** — redefines the text scale toward pure black/white, collapses
  `--border` onto `--border-mid`, and swaps `--gold` / `--success` for
  `--gold-dim`
- **Print** (`@media print`) — white page, black text, all chrome hidden, all
  transitions off, gold dropped to `--gold-dim` so it survives a mono printer

An element styled with literals appears identically in all four, which means it
appears *wrong* in at least three.

---

## What This Is Not

- Not a marketing site — no gradients, no hero sections, no decorative
  illustrations
- Not a generic dashboard — no Inter, no card grids, no purple accent
- Not a form wizard — the workflow steps are a physical process (3D printing),
  not a software form
- Not a place for emoji. Glyphs are inline SVG, drawn at the size they are used.

The aesthetic reference is precision instrument panels and engineering
printouts: warm, measured, purposeful.

---

## Reviewing a UI diff

Every line below is checkable against the diff alone.

- [ ] Every `font-size` is `var(--text-xs|sm|base|lg)` — no px literal, and
      nothing at 8, 10, 12, 14, 18 or 22px
- [ ] Every font-family is Rajdhani, Outfit or DM Mono, in its correct role, with
      only `system-ui` / `sans-serif` / `monospace` as fallback
- [ ] Numbers, measurements and status values are DM Mono
- [ ] Every colour is a token — no hex literal, no `rgb()`, no named colour
      (including `white`) outside the `:root` blocks
- [ ] No `var(--token)NN` alpha-suffix constructions
- [ ] No purple, cyan, blue, green or teal in the chrome; `--success` is gold
- [ ] No gradient outside a legend ramp, a colormap swatch, or `shimmer` on a
      loading skeleton
- [ ] Every geometry `color` attribute write uses a `*Linear` helper; every
      browser-painted swatch uses the sRGB one
- [ ] Light intensities still sum to 1.0 and are untinted
- [ ] Data-carrying meshes are built via `makeStressMaterial()`, `flatShading:
      false`
- [ ] Every spacing value is `var(--sp-1..4)`
- [ ] Border radius is 0 / 2px / 4px (or 50% for a circular indicator), matched
      to element type
- [ ] Transitions name their properties and use `--t-fast` or `--t-slow`; no
      `transition: all`
- [ ] New animation honours `prefers-reduced-motion`
- [ ] The change still reads correctly in light, high-contrast and print
- [ ] A new view mode is declared in `MODE_META`, not in a bespoke paint path
- [ ] A view with no measurement is hidden, not painted as zero
- [ ] Any new "uncertain" signal says *where*, not only globally
- [ ] No emoji anywhere
