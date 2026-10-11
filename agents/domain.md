# Domain docs

Ajour uses one domain context across its web, desktop, API, and shared
packages. Write domain documentation in English.

## Before exploring domain behavior

Read these files when they exist:

- `agents/GLOSSARY.md` for domain terms.
- Relevant ADRs in `agents/adr/` for recorded decisions.

If these files are absent, continue silently. Create them only when
domain-modeling work resolves a term or records a decision.

## File layout

```text
agents/
  GLOSSARY.md
  adr/
    0001-<decision-name>.md
```

These paths replace the engineering skills' default root glossary
and `docs/adr/` paths.

## Vocabulary

Use glossary terms in issue titles, proposals, code comments, and tests.
Preserve code identifiers and API names.

If a needed term is missing, check the existing project language before
introducing it. Record resolved terminology through domain-modeling.

## Decision conflicts

If a proposal contradicts an ADR, identify the ADR and explain why the
decision should be reconsidered before proceeding.
