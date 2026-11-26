# Accessibility report (Phase 8)

Target: WCAG 2.2 AA. The browser checks (`apps/web/e2e/smoke.mjs`, run in CI) run axe-core with `wcag2a`, `wcag2aa`
and `wcag22aa` on 17 page states; a serious or critical violation fails the run. Result on 2026-11-26: 0 serious or
critical issues. Dialogs, menus and drawers use Radix primitives (focus trapped while open, returned on close), and
motion respects `prefers-reduced-motion`.

Not yet done: a manual screen reader pass (NVDA, VoiceOver), a manual contrast check of text on glass panels (axe
leaves some blurred backgrounds for manual review), and 200% zoom and 320 px reflow on data tables.
