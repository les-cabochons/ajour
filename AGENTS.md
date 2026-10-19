# Agent Guidance

Use `just` to interact with this project.

## Repository context

The `docs/agents/` directory keeps the project context used by developers and
coding agents. Keep these documents in that directory rather than recreating
root-level copies. Before non-trivial changes, read the files that apply:

- [`docs/agents/project-overview.md`](docs/agents/project-overview.md) explains product scope, users, workflows, and the local-first intent.
- [`docs/agents/architecture.md`](docs/agents/architecture.md) defines runtime, persistence, dependency, and privacy boundaries.
- [`docs/agents/code-standards.md`](docs/agents/code-standards.md) records implementation, testing, verification, performance, and repository conventions.
- [`docs/agents/library-docs.md`](docs/agents/library-docs.md) indexes canonical libraries and local module ownership.
- [`docs/agents/ux-spec.md`](docs/agents/ux-spec.md) defines how Ajour behaves for the user. The PR that changes a behavior updates it.
- [`docs/agents/ui-rules.md`](docs/agents/ui-rules.md) defines interaction, accessibility, layout, and visual rules for UI work.
- [`docs/agents/ui-tokens.md`](docs/agents/ui-tokens.md) documents the semantic design tokens owned by the web app.
- [`docs/agents/ui-registry.md`](docs/agents/ui-registry.md) catalogs reusable UI patterns and component ownership.
- [`GLOSSARY.md`](GLOSSARY.md) defines the domain terms, and [`docs/adr/`](docs/adr/) records the decisions behind them.

Design specs written before the engineering skills are frozen in
[`docs/specs/`](docs/specs/). New specs are tracker issues.

## Architectural direction

Keep deterministic web behavior in `apps/web/src/domain`, runtime and persistence
adapters in `apps/web/src/lib`, workflow UI in `apps/web/src/features`, and reusable
controls in `apps/web/src/components`. Extend the owning transition module instead
of rebuilding lifecycle rules in `local-store.ts` or React components.

Packages are deep modules: see [`packages/README.md`](packages/README.md) before
adding a package or importing from one.

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

## Agent skills

Write all repository documentation, tickets, comments, and pull requests in English.

### Workflow

Planning happens in the issue tracker, not in repository files. Use the skill
that matches the stage of the work:

1. A large effort whose route is still unclear gets a map of decision tickets: `wayfinder`.
2. A settled idea becomes a spec issue: `to-spec`.
3. A spec becomes tracer-bullet tickets with blocking edges: `to-tickets`.
4. Tickets are built test-first: `implement` for one ticket, `implement-spec` for a whole spec, both with `tdd`.
5. A branch or PR is reviewed against these standards and its ticket: `code-review`.
6. A PR body is written with `pr`.
7. A module's interface or seams are designed with `codebase-design`.
8. Incoming issues move through the triage labels: `triage`.
9. Domain terms and decisions are recorded with `domain-modeling`, in `GLOSSARY.md` and `docs/adr/`.

Throwaway work never merges. Research findings go in `docs/research/<slug>.md`
on a `research/<slug>` branch, and prototypes go on a `prototype/<slug>`
branch. Push the branch, open no PR, and link it from the ticket.

### Issue tracker

Track work in GitHub Issues for `les-cabochons/ajour`. Before reading,
creating, or updating tickets, read `docs/agents/issue-tracker.md`.

### Triage labels

Use the five default triage labels. Before triaging tickets, read
`docs/agents/triage-labels.md`.

### Domain docs

Use a single-context glossary and ADR collection for all Ajour packages.
Before exploring domain behavior, read `docs/agents/domain.md`.
