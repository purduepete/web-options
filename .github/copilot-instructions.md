# WebOptions repository instructions

## Responsive UI contract

Every frontend page must work from a narrow phone through a large desktop. This
contract applies to existing pages and every page added under `frontend/src/pages`.

- Use a semantic `main` page root so shared viewport padding, safe-area insets,
  text wrapping, and page-entry behavior apply consistently.
- Build phone-first. At 320 CSS px wide, the document must not scroll
  horizontally and content must not be clipped or overlap.
- Do not give layout elements fixed `width` or `min-width` values. Use `%`,
  `min()`, `max()`, `clamp()`, `calc()`, or flexible grid/flex tracks. Fixed
  dimensions up to 48px are reserved for icons, spinners, and swatches.
- Flex rows containing headings, navigation, filters, pills, or actions must wrap.
  Inputs in those rows must be allowed to shrink to the available width.
- Fixed-count grids must collapse to one column by 640px. Prefer `auto-fit` with
  fluid `minmax()` tracks when the content can reflow without a breakpoint.
- Desktop-only layout rules above 1100px must also require a fine pointer or hover
  capability. Width alone does not distinguish a landscape tablet from a laptop.
- Keep touch targets at least 44px in both dimensions for coarse pointers. Do not
  hide controls behind hover-only interaction.
- Preserve `viewport-fit=cover` and use `env(safe-area-inset-*)` in addition to,
  rather than instead of, the normal page gutters.
- Long symbols, URLs, and user-provided text must wrap inside their column.
- The day-card calendar uses row subgrid for vertical alignment. Responsive rules
  may change its columns, but must not remove or replace its subgrid rows.

Run `npm test -- --run frontend/test/responsive-css.test.ts frontend/test/grid-css.test.ts frontend/test/safe-area-css.test.ts`
after changing page markup or CSS, then run `npm run build:frontend`.
