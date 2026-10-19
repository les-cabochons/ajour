# Domain docs

Ajour uses one domain context across its web, desktop, API, and shared
packages. Write domain documentation in English.

## Before exploring domain behavior

Read these files when they exist:

- `GLOSSARY.md` at the repository root for domain terms.
- Relevant ADRs in `docs/adr/` for recorded decisions.

If these files are absent, continue silently. Create them only when
domain-modeling work resolves a term or records a decision.

## File layout

```text
GLOSSARY.md
docs/
  adr/
    0001-<decision-name>.md
```

These are the engineering skills' default paths.

## Vocabulary

Use glossary terms in issue titles, proposals, code comments, and tests.
Preserve code identifiers and API names.

If a needed term is missing, check the existing project language before
introducing it. Record resolved terminology through domain-modeling.

## Decision conflicts

If a proposal contradicts an ADR, identify the ADR and explain why the
decision should be reconsidered before proceeding.
