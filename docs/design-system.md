# Design System & Philosophy

This is the source of truth for how EasyReporting looks and feels. It exists so the
product stays visually consistent as pages and contributors are added over time.

**Read this before building any UI.** If a change conflicts with something here, change
this document deliberately first — don't quietly diverge.

The platform is **customer-facing**. For our use case, great-looking, trustworthy design
is almost the most important part of the product. Treat polish as a feature, not a finish.

---

## 1. Who we design for

| Audience | Share | What they need |
|---|---|---|
| Non-technical business users | Primary | Read a chart in 3 seconds. Never feel lost. No jargon. |
| Technical / analyst users | Secondary | Get to the underlying numbers and drill down without friction. |

The resolution of these two: **a calm, simple surface with depth available on demand.**
The default view is uncluttered; detail is one interaction away, never forced on everyone.

---

## 2. Design principles (non-negotiable)

These are the philosophies every screen is measured against.

1. **Clarity over density.** A non-technical user should understand the main message of a
   screen at a glance. White space is a feature. When in doubt, remove.

2. **Progressive disclosure — overview → drill-down → detail.** Every screen has three
   reachable layers:
   - **Overview** – the headline visual / number.
   - **Drill-down** – click an element (a bar, a slice, a row group) to narrow the data.
   - **Detail** – land on the Data page, filtered to exactly what was clicked.

   No screen should dump all three layers at once. Lead with the overview.

3. **Tooltips are the "extra layer."** Hover reveals supporting context (exact values,
   definitions, % change) without cluttering the resting state. Anything a power user
   might want but a casual user doesn't need at rest belongs in a tooltip.

4. **One visual language, many brands.** Layout, spacing, type scale, and interaction
   patterns are identical for every customer. Only **color, logo, and font family** change
   per company (see §6). White-labeling never means a different *structure*.

5. **Fast is part of looking good.** Perceived speed is a design property. Prefer skeleton
   loaders over spinners, avoid layout shift, keep the bundle lean (this is why we
   hand-roll on tokens rather than ship a heavy component library).

6. **Trust through restraint.** This shows people their business data. Avoid gimmicks,
   excessive animation, and decorative color. Muted, professional, precise.

7. **Tokens, always.** Never hardcode a color, font, radius, or shadow in a component.
   Every visual value comes from a design token (§5). This is what makes theming and dark
   mode possible at all — a hardcoded `text-blue-600` is a bug, not a style.

---

## 3. Aesthetic direction — Modern minimal SaaS

The reference points are Stripe, Linear, and Vercel dashboards: airy, precise, premium,
quietly confident.

- **Generous whitespace.** Crowding reads as cheap. Give content room.
- **Soft, low elevation.** Subtle shadows and hairline borders define surfaces — not heavy
  drop shadows or hard 1px black lines.
- **Rounded, not bubbly.** Consistent medium radii. Nothing sharp, nothing pill-shaped
  except true pills (badges, toggles).
- **Restrained color.** The interface is mostly neutral grays. Brand color is an *accent*
  — used for primary actions, active states, key data — not for filling large areas.
- **Quiet motion.** Transitions are short (150–200ms) and only on interactive feedback
  (hover, focus, expand). No looping or attention-seeking animation.
- **Crisp typography.** Strong type hierarchy does most of the layout work.

---

## 4. Typography

- **Default family:** Geist (already wired via `next/font`). The active font is a token
  (`--font-sans`) so a company can override it (§6).
- **Numbers matter.** This is a data product. Use **tabular figures** for any column or
  metric where digits should align (`font-variant-numeric: tabular-nums`).

Type scale (use these roles, not arbitrary sizes):

| Role | Size / weight | Use |
|---|---|---|
| Display | 30px / 600 | Page-level KPI numbers |
| Heading | 20px / 600 | Page titles, card titles |
| Subheading | 16px / 500 | Section labels |
| Body | 14px / 400 | Default UI text, table cells |
| Caption | 12px / 500 | Tooltips, axis labels, metadata |

Keep line length readable; left-align text, right-align numeric columns.

---

## 5. Design tokens (the system)

Everything visual is a **CSS custom property**, defined once, consumed everywhere through
Tailwind v4's `@theme inline`. White-labeling and dark mode are nothing more than swapping
the values of these variables — components never change.

### Token layers

1. **Primitive tokens** — raw values (a specific gray, the brand hue). Rarely used directly.
2. **Semantic tokens** — *role-based* names that components actually consume. This layer is
   the contract. A component asks for `--color-surface`, not "white" or "gray-50".

Always consume **semantic** tokens in components.

### Semantic token set

| Token | Role |
|---|---|
| `--color-background` | App canvas (behind cards) |
| `--color-surface` | Card / panel background |
| `--color-surface-muted` | Subtle fills (table header, hover rows) |
| `--color-border` | Hairline borders, dividers |
| `--color-foreground` | Primary text |
| `--color-foreground-muted` | Secondary text, captions |
| `--color-primary` | Brand accent — primary buttons, active nav, key series |
| `--color-primary-foreground` | Text/icon on a primary fill |
| `--color-primary-hover` | Hover state of primary |
| `--color-ring` | Focus ring |
| `--color-success` / `--color-warning` / `--color-danger` | Status, validation, deltas |
| `--font-sans` | Active UI font family |
| `--radius` | Base corner radius (cards/inputs derive from this) |
| `--shadow-sm` / `--shadow-md` | Elevation steps |

Spacing follows Tailwind's default 4px scale — don't invent custom spacing tokens; the
scale is already consistent.

### Light + dark

Dark mode swaps the **neutral** tokens (background/surface/border/foreground) and adjusts
brand tokens for contrast. It is implemented as an alternate block of the same semantic
variables (e.g. under `[data-theme="dark"]`), selected per user/company default with an
optional user toggle. Because components only read semantic tokens, **no component needs
dark-mode-specific code.**

> Migration note: the current code (`layout.tsx`, components) still uses hardcoded Tailwind
> palette classes like `bg-gray-50` and `text-blue-600`. These predate this system and
> should be migrated to semantic tokens (`bg-background`, `text-primary`) when each surface
> is next touched. New code uses tokens from the start.

---

## 6. White-labeling / theming model

**Each user belongs to a company. Each company has a brand.** Branding is resolved
**server-side**, from the same trusted context that enforces data access — never from the
client.

### What a company can brand

| Brandable | Token(s) affected | Notes |
|---|---|---|
| Primary / accent color | `--color-primary*` | One brand hue; we derive hover/foreground from it to guarantee contrast. |
| Logo | (asset, not a token) | Shown in the header; falls back to product name. |
| Font family | `--font-sans` | From an approved/self-hosted set, to keep load fast and licensing clean. |
| Default color mode | light / dark | Per-company default; user may still toggle. |

Structure, spacing, type scale, and the neutral palette are **not** brandable — that's how
every tenant stays well-designed regardless of the color they pick.

### How it resolves (the seam)

`UserContext` (see `src/lib/auth/types.ts`) already carries `tenantId` and is produced
server-side by `getUserContext()`. Theming hangs off the same seam:

```
getUserContext()  ──►  tenantId / companyId
        │
        ▼
  getBranding(companyId)  ──►  { primary, logoUrl, fontFamily, defaultMode }
        │
        ▼
  injected as CSS variables on <html> in the root layout (server-rendered)
```

The branding lookup is an abstraction (like `DataProvider`): a default implementation can
read a config file or table; real deployments swap in their own. **Branding, like data
access, is decided on the server from the authenticated company — the client cannot ask to
be styled as another company.**

### Guardrails (keep every tenant looking good)

- Derive `--color-primary-hover` and `--color-primary-foreground` from the brand hue with a
  guaranteed contrast ratio; never trust a raw client color to be legible.
- Enforce a **minimum contrast** (WCAG AA, §8) between brand color and its foreground; if a
  chosen brand color fails, adjust the derived foreground, not the layout.
- Brand color is an **accent only** — it must never become a full-bleed background, or the
  "calm neutral surface" principle breaks.

---

## 7. Charts

Charts are the heart of the product and must obey the same system.

- **Inherit tokens.** ECharts gets a theme built from the semantic tokens — series colors,
  axis/label color, gridlines, and tooltip styling all read from `--color-*`. A company's
  brand color flows into charts automatically; dark mode restyles charts with no per-chart
  code.
- **Series palette.** The first/primary series uses `--color-primary`. Additional series use
  a fixed, accessible categorical palette derived to harmonize with the brand hue — not
  random colors.
- **Tooltips on hover** are mandatory (principle 3): show exact values, the dimension being
  viewed, and where useful a delta. Caption type scale, surface background, hairline border.
- **Drill-down is the default interaction.** Clicking a chart element navigates to the Data
  page filtered to that element (already implemented in `ChartCard`). Every clickable
  element should signal it (cursor + subtle hover emphasis).
- **Honest charts.** Default bar/area axes to a zero baseline. Don't truncate axes to
  exaggerate change. Don't use 3D or decorative effects.
- **Empty / loading / error states** are designed, not afterthoughts: skeleton while
  loading, a clear empty message, and the visible (non-blank) error surface already used for
  access errors.

---

## 8. Accessibility (the bar)

Because we hand-roll components, we own accessibility — meet it deliberately.

- **Contrast:** WCAG **AA** minimum (4.5:1 body text, 3:1 large text / UI boundaries).
  This is enforced in the theming guardrails, not left to chance.
- **Keyboard:** every interactive element is reachable and operable by keyboard; visible
  focus ring via `--color-ring`. Never remove focus outlines without replacing them.
- **Semantics:** real semantic HTML and ARIA on custom controls (dialogs trap focus, menus
  are arrow-navigable, tables use proper headers).
- **Not color alone:** never encode meaning in color only (e.g. up/down) — pair with an
  icon, sign, or label, which also protects color-blind users and brand recoloring.
- **Motion:** respect `prefers-reduced-motion`.

---

## 9. Layout & navigation conventions

- **App shell:** persistent top header (logo + primary nav) on a `--color-surface`
  background with a hairline bottom border. Content sits on `--color-background`.
- **Content in cards.** Charts, tables, and panels live in `--color-surface` cards with
  `--radius`, a hairline border, and at most `--shadow-sm` at rest.
- **Responsive grid** for the dashboard; cards reflow, never overflow horizontally.
- **One primary action per view.** The single most important action uses the brand-colored
  primary button; everything else is secondary/ghost.
- **Consistent page anatomy:** title (Heading) → optional filter/context bar → content.

---

## 10. How to keep this consistent

A practical checklist for any UI PR:

- [ ] No hardcoded colors/fonts/radii/shadows — only semantic tokens.
- [ ] Works in **both** light and dark (you changed tokens, not components).
- [ ] Still looks right if `--color-primary` is swapped to an arbitrary brand color.
- [ ] Overview reads in seconds; detail is reachable via drill-down, not forced.
- [ ] Hover tooltips provide the supporting layer where useful.
- [ ] Keyboard-navigable with a visible focus ring; meets AA contrast.
- [ ] Loading, empty, and error states are designed.

If you need something this document doesn't cover, **add it here in the same PR** so the
next person inherits the decision.
