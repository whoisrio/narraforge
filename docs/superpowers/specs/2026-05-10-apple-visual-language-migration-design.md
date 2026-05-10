# Apple Visual Language Migration Design

**Date:** 2026-05-10
**Scope:** Frontend visual tokens only — no layout, structure, or logic changes

## Strategy

Apply `design.md` Apple design tokens to the existing CSS variable system. Replace color, typography, spacing, radius, and shadow values. Keep page structure, component structure, and inline-style patterns unchanged.

## Color Mapping

| Variable | Current | → Apple | Source |
|---|---|---|---|
| `--color-primary` | `#1976d2` | `#0066cc` | Action Blue |
| `--color-primary-light` | `#42a5f5` | `#0071e3` | Focus Blue |
| `--color-primary-dark` | `#1565c0` | `#0055aa` | Active state |
| `--color-secondary` | `#2196f3` | `#2997ff` | Sky Link Blue |
| `--color-background` | `#fafafa` | `#f5f5f7` | Parchment |
| `--color-surface` | `#ffffff` | `#ffffff` | Pure White (unchanged) |
| `--color-surface-hover` | `#f8f9fa` | `#fafafc` | Pearl |
| `--color-text-primary` | `#333333` | `#1d1d1f` | Near-Black Ink |
| `--color-text-secondary` | `#666666` | `#7a7a7a` | Ink Muted 48 |
| `--color-text-muted` | `#999999` | `#cccccc` | Body Muted |
| `--color-border` | `#e0e0e0` | `#e0e0e0` | Hairline (unchanged) |
| `--color-border-light` | `#eeeeee` | `#f0f0f0` | Divider Soft |

## Typography Mapping

| Variable | Current | → Apple |
|---|---|---|
| Font family | system-ui stack | `Inter, system-ui, -apple-system, sans-serif` |
| `--font-size-base` | `16px` | `17px` |
| `--font-size-xs` | `12px` | `12px` (unchanged) |
| `--font-size-sm` | `14px` | `14px` (unchanged) |
| `--font-size-lg` | `18px` | `18px` (unchanged) |
| `--font-size-xl` | `20px` | `21px` |
| `--font-size-2xl` | `24px` | `24px` (unchanged) |
| `--font-size-3xl` | `30px` | `34px` |
| `--font-size-4xl` | `36px` | `40px` |
| `--line-height-normal` | `1.5` | `1.47` |
| Display headings | no letter-spacing | `-0.02em` |
| Heading weight | 600/700 | 600 only |
| `--font-weight-medium` | `500` | remove (Apple skips 500) |

## Spacing, Radius & Shadow

| Variable | Current | → Apple |
|---|---|---|
| `--spacing-md` | `16px` | `17px` |
| `--radius-sm` | `4px` | `5px` |
| `--radius-lg` | `12px` | `18px` |
| `--radius-xl` | `16px` | `18px` (merge into lg) |
| `--shadow-sm` | multi-layer | `none` |
| `--shadow-md` | multi-layer | `1px solid rgba(0,0,0,0.08)` (hairline border) |
| Primary button radius | `var(--radius-lg)` | `9999px` (pill) |
| Button active state | none | `transform: scale(0.95)` |

## Files to Modify

1. `src/styles/design-system.css` — update all token values
2. `src/styles/variables.css` — sync updates
3. `src/styles/global.css` — add Inter font, update global styles
4. `index.html` — add Inter Google Fonts link
5. `src/components/ui/Button.tsx` — update hardcoded colors and border-radius to pill
6. CSS Module files — update hardcoded color values to CSS variable references

## Out of Scope

- Page layout structure (two-column grid, tab navigation)
- Component logic and TypeScript code
- Inline-style patterns (work via CSS variable indirection)
- API layer, routing, state management
- Dark mode activation
- New pages or components
- Backend changes
- Responsive breakpoint changes
