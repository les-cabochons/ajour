# Agent Guidance

Use `just` to interact with this project.

## Repository context

The `agents/` directory keeps the project context used by developers and coding
agents. Keep these documents in that directory rather than recreating root-level
copies. Before non-trivial changes, read the files that apply:

- [`agents/project-overview.md`](agents/project-overview.md) explains product scope, users, workflows, and the local-first intent.
- [`agents/architecture.md`](agents/architecture.md) defines runtime, persistence, dependency, and privacy boundaries.
- [`agents/code-standards.md`](agents/code-standards.md) records implementation, testing, and repository conventions.
- [`agents/library-docs.md`](agents/library-docs.md) indexes canonical libraries and local module ownership.
- [`agents/writing-plan.md`](agents/writing-plan.md) gives the planning checklist and default verification path.
- [`agents/progress-tracker.md`](agents/progress-tracker.md) records the current baseline, completed work, and pending verification.
- [`agents/ui-rules.md`](agents/ui-rules.md) defines interaction, accessibility, layout, and visual rules for UI work.
- [`agents/ui-tokens.md`](agents/ui-tokens.md) documents the semantic design tokens owned by the web app.
- [`agents/ui-registry.md`](agents/ui-registry.md) catalogs reusable UI patterns and component ownership.

## Architectural direction

Keep deterministic web behavior in `apps/web/src/domain`, runtime and persistence
adapters in `apps/web/src/lib`, workflow UI in `apps/web/src/features`, and reusable
controls in `apps/web/src/components`. Extend the owning transition module instead
of rebuilding lifecycle rules in `local-store.ts` or React components.

Examples:

```sh
just
just install
just start
just test
just typecheck
just format
just build
just clean
```
