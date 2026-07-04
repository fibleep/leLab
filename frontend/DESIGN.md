# North Star Horizon — Design System

Adapted from the Caliban design language for the LeRobot control platform. **This file is the single source of truth.** Every page and component must use these tokens and patterns. When converting a page, read this file first.

## Posture

Command center, not consumer app. Industrial-telemetry: a workbench for turning camera data into robot policy. Every pixel earns its place. Reference lineage: Swiss industrial print + tactical telemetry + Linear's density.

## The one-line rule set

1. **One accent, one action.** Amber (`brand`) means "act on this" — primary CTAs, the active step, live status. Never decorative.
2. **Monospace = system voice.** Space Mono for labels, kickers, nav, metrics, status codes, timestamps. Geist for human prose (descriptions, body). Never cross them.
3. **Borders over boxes.** 1px borders divide structure. No drop shadows, no elevation, no glow. Panels are outlined, not floated. (Cards may use a subtle `radius-panel` of 6px — the mockup softens pure brutalism slightly; the pill nav is fully rounded.)
4. **Paper first.** Default theme is warm paper (light). Dark is wired and supported via `[data-theme="dark"]`, but the mockup — and the default — is paper.
5. **Grid paper everywhere.** The page background carries a faint 32px graph-paper grid.
6. **Max 3 text colors** per screen: primary, secondary, muted.

## Tokens (defined in `src/index.css`, mapped in `tailwind.config.ts`)

### Color (Tailwind class → token)
- `bg-surface` `#FAF7F0` — page background (paper)
- `bg-elevated` `#FFFFFF` — panels
- `bg-subtle` `#F0EDE4` — hover, input backgrounds
- `text-ink` `#1F1B16` — primary text (`text-primary`)
- `text-ink-2` `#5C564E` — secondary text
- `text-ink-3` `#8A8378` — muted: kickers, metadata, timestamps
- `border-line` `rgba(31,27,22,0.12)` — primary borders
- `border-line-soft` `rgba(31,27,22,0.07)` — internal dividers
- `text-brand` / `bg-brand` `#D4891A` (light) / `#F5A623` (dark) — THE accent
- `bg-brand-muted` `#B8760F` — pressed/hover on brand
- `text-success` `#6F7D3A` (olive) — online/ready/complete dots
- `text-warning` `#C88A1E` · `text-error` `#C0392B` · `text-info` `#3E6FB0`

Dark mode swaps surfaces to `#050505/#0C0C0C/#141414`, ink to `#F2EFE7/#CCC7BB/#8F8A80`, brand to `#F5A623`.

### Type (Tailwind class)
- `font-mono` → Space Mono (system voice). `font-sans` → Geist (human voice).
- Kickers: `font-mono text-[11px] uppercase tracking-[0.12em] text-ink-3`
- Section title: `font-mono text-sm uppercase tracking-[0.1em] text-ink`
- Display/hero: `font-mono font-bold uppercase tracking-tight` at `clamp()` scale, dot-matrix filled (use `.dot-matrix-text`)
- Heading: `font-sans font-medium text-base` · Body: `font-sans text-sm text-ink-2 leading-relaxed`
- Metrics/values: `font-mono tabular-nums`. Body never below 14px; kickers 11px floor.

### Shape
- Rectangles: `rounded-panel` (6px) for cards/panels; `rounded-none` for dense telemetry cells; `rounded-full` for the nav pill, status dots, avatars, and brand action pills.
- Borders: `border border-line`. Dividers: `border-line-soft`.

### Spacing
4px base. Panel padding `p-5`/`p-6`. Section gaps `gap-4`/`gap-6`. Max content width `max-w-[1400px] mx-auto`, page padding `px-6`/`px-8`.

## Signature elements (in `src/components/brand/`)

- **`<DotMatrixHeading>`** — the big paper-dot headline (`.dot-matrix-text` utility: Space Mono 900, radial-dot fill via `background-clip:text`, alternating amber/ink runs). Used for page hero lines like "DATA BECOMES POLICY."
- **`<NorthStarMark>`** — the 4-point compass star glyph (SVG), amber. The brand mark.
- **`<GridBackdrop>`** — fixed graph-paper grid layer (already applied to `body`).
- **`<Kicker>`** — uppercase mono label. **`<StatusDot>`** — 6px semantic dot + text label (never color-only).
- **`<Panel>`** — outlined container: `bg-elevated border border-line rounded-panel`, with an optional mono `title` kicker header.
- **`<StepRow>`** — numbered workflow row (circle index + title + description + action), amber circle when active.

## Chrome

- **TopNav** (`components/nav/TopNav.tsx`): floating pill, centered, `top-5`. Left: `<NorthStarMark>` + `NORTH STAR` (mono, bold, tracking-[0.2em]). Center: nav links (mono, uppercase) Dashboard · Datasets · Training · VR. Right of pill: amber `RECORD EPISODE` action. Outside pill (top-right): HF status chip + help `?`. Pill: `bg-[var(--nav-pill)] backdrop-blur border border-line rounded-full`.
- **Footer**: left `System status ● All systems go` (mono + success dot); right Documentation · GitHub · Discord (mono links with lucide icons).

## Buttons (restyled `ui/button.tsx`)
- `default` (primary): `bg-brand text-surface` (dark ink text on amber), mono uppercase tracking, `rounded-full` for pill actions or `rounded-panel` for inline.
- `outline`/`ghost`: transparent, `border border-line`, `text-ink-2`, hover `bg-subtle`.
- `destructive`: `text-error border-error`.
- All: `font-mono text-xs uppercase tracking-[0.1em]`, min-height 40px, press `active:opacity-70`. No shadows.

## Anti-patterns (do NOT)
No drop shadows/elevation/glow. No gradient fills (except the dot-matrix headline + faint grid). No blue/purple accents — amber is the only accent. No emojis (use lucide or ASCII). No rounded corners on dense data cells. No more than 3 text colors. No tooltips as primary explanation. Honor `prefers-reduced-motion`. Motion budget: 150ms color, 100ms press; no spring, no parallax.

## Functionality is frozen
This is a **visual** redesign. Do not change props, API calls, routes, hooks, state, or behavior — only markup/className/structure. Every existing handler, fetch, and data flow must remain identical.
