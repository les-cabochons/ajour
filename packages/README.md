# Packages

Every workspace package here is a deep module: a lot of behaviour behind a
small interface. The interface is the package's **entry points**, which are the
files at the package root. Everything in a subfolder is private.

```
packages/
  <name>/
    package.json    ← "main" points at index.ts
    index.ts        ← an entry point (public). Import this from outside.
    client.ts       ← another entry point. A package may expose several.
    lib/            ← implementation: hidden from outside, free to import each other.
    tests/          ← tests and fixtures (a subfolder, so private).
```

Copy `packages/example/` to start a new package, or delete it.

## Rules

`just lint-boundaries` (also part of `just typecheck`) runs
[dependency-cruiser](https://github.com/sverweij/dependency-cruiser) with
[`.dependency-cruiser.cjs`](../.dependency-cruiser.cjs) and fails on any of these:

1. **Entry-point boundary.** Code outside a package (app code or another
   package) imports only that package's entry points, through `@ajour/<name>`
   or a relative path to a root file, never a file in a subfolder.
2. **Intra-package freedom.** A package's own files import each other freely.
3. **Tests through the entry points.** Files in `<name>/tests/` import entry
   points and their own `tests/` fixtures, never any package's subfolder
   internals, not even their own package's.
4. **No cycles.** No dependency cycles anywhere in `packages/` or `apps/`.

Packages also may not import from `apps/`. Type-only imports count.

## Entry points, not barrels

Prefer several small entry points (`timeline.ts`, `connectors.ts`) over one
`index.ts` that re-exports a whole subtree. A barrel makes the interface as wide
as the implementation and hides which callers depend on what. Adding an entry
point is just adding a root file. Any new subfolder is private automatically, so
the config never needs editing.

`@ajour/shared`'s `index.ts` is still a barrel because the web app imports
everything through `@ajour/shared`. Prefer adding focused root entry points over
growing it.
