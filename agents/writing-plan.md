# Writing Plan

Use this file to keep agent-generated implementation writing grounded before changing code.

## Before Editing

- Read the relevant feature, shared logic, and tests.
- Identify the owning runtime: web, desktop, api, or shared.
- For web code, identify the owning layer: pure domain, runtime/application library, feature workflow, or reusable component.
- Check whether the change touches local-first privacy boundaries.
- Check whether persisted local state needs compatibility handling.
- For UI changes, check `agents/ui-rules.md`, `agents/ui-registry.md`, `agents/ui-tokens.md`, and `agents/library-docs.md` before editing.
- State the intended files before editing when the change is non-trivial.

## Implementation Notes

- Keep edits scoped to the requested behavior.
- Prefer existing component and helper patterns.
- Use structured parsers and validators at boundaries.
- Keep UI changes aligned with `agents/ui-rules.md` and `agents/ui-tokens.md`.
- Keep operational behavior aligned with `agents/architecture.md` and `agents/code-standards.md`.
- Keep `apps/web/src/domain` pure, and do not introduce `features` imports into `domain` or `lib`.
- For lifecycle changes, start from the owning transition module documented in `agents/library-docs.md`; keep `local-store.ts` as persistence and command wiring.
- Prefer local UI primitives and app-surface wrappers over repeated raw CSS class groups.
- When a page grows mixed responsibilities, extract feature-local UI modules before adding more inline rendering.
- Do not introduce new direct `settings-panel`, `message-panel`, or raw checkbox usage in feature code.

## Verification Notes

Default verification:

```sh
just test
just typecheck
just build
```

For narrow changes, run the closest focused tests first, then broader checks if risk remains.

For visual changes, start the app and inspect the affected view in a browser.

Useful consistency checks:

```sh
rg -n 'settings-panel|message-panel' apps/web/src/features
rg -n 'type="checkbox"' apps/web/src/features
rg -n '@base-ui/react' apps/web/src/features
rg -n 'from "@/features/' apps/web/src/domain apps/web/src/lib
rg -n 'hours-input|project-task-budget|project-task-import-utils' apps/web/src
rg -n 'features/backlog/(work-item-estimates|work-item-hierarchy)' apps/web/src
rg -n 'window.addEventListener\("pointer(move|up|cancel)"' apps/web/src/features
rg -n '^function (formatPriorityInput|parsePriorityInput|formatEstimateInput|parseEstimateInput|buildManualTimeEntryNote)' apps/web/src/features/backlog
```

Expected direction: feature code should consume pure behavior from `domain`, runtime behavior from `lib`, local wrappers from `apps/web/src/components/ui`, app-level surfaces from `apps/web/src/components/app-surface.tsx`, or feature-local modules that own repeated rendering. The checks should not find boundary violations or imports from retired utility paths.

## Open Decisions

- Decide whether future backlog imports should share one review model across plugin sources.
- Decide whether local diagnostics should get a first-class UI under Settings Debug.
- Decide whether desktop-only behavior should be exposed as explicit capabilities in shared runtime helpers.
