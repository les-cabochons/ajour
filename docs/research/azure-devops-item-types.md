# Item types in Azure DevOps: what the source sends and what Ajour reads

Research for item types in Ajour: one backlog experience over sources whose
item types keep their text and estimates in different fields. Checked on
2026-10-30 against:

- the Azure DevOps plugin on `ajour-plugins` `main` (`1307831`, plugin 1.1.1),
- Ajour `main` (`03ff8b16`),
- Azure DevOps REST 7.1, read live from the user's work organization: type
  metadata, form definitions, and the fields filled on recent items, up to 60
  per type. Only field names and counts were read out, never values.

This repository is public, so organization, client and project names are left
out. "The work org" is one organization with 8 client projects that all use one
inherited Scrum process with three custom types. Some older projects use an
inherited Agile process.

## Summary

- The plugin reads one text field, `System.Description`, for every type. Bug
  and Defect forms don't show that field. They show Repro Steps, which 37 of
  41 recent Bugs fill, against 2 for Description. Bugs reach Ajour with no
  description.
- The connection has one field name per Ajour estimate, for every type. The
  work org's Product Backlog Item (PBI) has no Original Estimate, Remaining
  Work or Completed Work, only Effort. PBIs reach Ajour with no estimate, and
  an estimate typed in Ajour is never sent, with no error.
- Ajour writes into fields the source form hides: a description written on a
  Bug goes to `System.Description`, and a remaining estimate on a Bug goes to
  Remaining Work. Neither shows on the Bug form.
- The plugin imports six type names it hardcodes. Defect, Suggestion, Feature
  Blocker, Feature and Epic never reach Ajour. Issue #364 already covers this.
- Azure DevOps describes each type well enough to map it without hardcoded
  names: type categories, each project's effort field, each type's form, and
  each type's color and icon. All four answer on the work org.

## What the plugin asks for today

All in `plugins/azure-devops/src/azure-devops.ts`.

| Step               | What it does                                                                                                                                                                                    |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Query              | WIQL on six hardcoded types: Task, Product Backlog Item, User Story, Requirement, Issue, Bug. `AssignedTo = @Me` or no owner filter. No state filter. `$top=200`, newest change first.          |
| Fields             | `workitemsbatch` with 8 base fields: Id, Title, Description, State, AssignedTo, IterationPath, TeamProject, WorkItemType. Plus the priority and 3 estimate fields the connection names, if set. |
| Relations          | A second `workitemsbatch` with `$expand: "Relations"`, for the parent and children only.                                                                                                        |
| Description        | `System.Description` only, as HTML or Markdown (`multilineFieldsFormat`). Written back to the same field.                                                                                       |
| Estimates          | One field name per Ajour estimate for the whole connection. Before a push, the plugin checks that the item's type has the field, and skips the push without a message when it doesn't.          |
| Type sent to Ajour | `workItemType`, the type's display name as a free string.                                                                                                                                       |

On the Ajour side, `workItemType` becomes `LocalWorkItem.sourceWorkItemType`
(`apps/web/src/domain/backlog/work-item-sync.ts:85`). Ajour shows it as a chip
on the item page and in the peek, in the editor subtitle, and as a backlog
filter. It has no color or icon, and nothing depends on its value.

The user's work org connection names `MS Priority`, `Original Estimate`,
`Remaining Work` and `Completed Work`.

## What Azure DevOps sends, by type

Form text fields come from the type's form definition. Estimate fields are the
ones on the form. Fill counts come from recent items in the 8 projects.

| Type (category)                       | Text fields on the form                               | Estimate fields on the form             | Filled on recent items                                                                                 |
| ------------------------------------- | ----------------------------------------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Task (task)                           | Description                                           | Original Estimate, Remaining, Completed | 60 items: Description 3, Original 59, Remaining 41, Completed 18, MS Priority 0                        |
| Defect, custom (task)                 | Repro Steps, System Info                              | Original Estimate, Remaining, Completed | 60 items, past year: Repro Steps 57, System Info 32, Description 1, Original 56, Completed 38          |
| Bug (bug)                             | Repro Steps, System Info                              | Effort                                  | 41 items: Repro Steps 37, Description 2, Effort 38, Remaining 0, MS Priority 7                         |
| Product Backlog Item (requirement)    | Description, Acceptance Criteria, a custom HTML field | Effort                                  | 60 items: Description 59, Acceptance Criteria 34 (26 more hold the template), Effort 9, MS Priority 19 |
| Suggestion, custom (requirement)      | Description, a custom Outcome field                   | none                                    | 5 items: Description 3                                                                                 |
| Feature Blocker, custom (requirement) | Description, Resolution                               | none                                    | 1 item                                                                                                 |
| Feature (feature)                     | Description, Acceptance Criteria                      | Effort                                  | 60 items: Description 50, Effort 23                                                                    |
| Epic (epic)                           | Description, Acceptance Criteria                      | Effort                                  | 8 items: Description 2                                                                                 |

Notes:

- A type's field list is wider than its form. Bug has `System.Description`
  and Remaining Work as fields, but neither is on the Bug form, so people never
  see or fill them.
- Text fields mix formats on the same type. 21 of 37 Bug Repro Steps are
  Markdown and 16 are HTML. The plugin's description code already handles both
  for `System.Description`.
- Priority (`Microsoft.VSTS.Common.Priority`) is set on every recent PBI,
  Task and Feature, most likely from its default value. MS Priority, the field the
  connection reads, is empty on all 60 Tasks.
- In the older Agile-based projects, User Story shows Story Points, Effort and
  the three task estimates. Bug shows Repro Steps, System Info, Story Points
  and the three task estimates.

## The user's two examples

**A Bug has no description but has repro steps.** The plugin reads only
`System.Description`, which the Bug and Defect forms don't show. 37 of 41
Bugs and 57 of 60 Defects keep their text in Repro Steps
(`Microsoft.VSTS.TCM.ReproSteps`). Reading it is one more field in the batch
request. Writing it back needs the same care as descriptions (ADR 0009). Today,
a description typed in Ajour on a Bug writes to `System.Description`, which the
Bug form doesn't show.

**A PBI has no Original Estimate but has Effort.** The work org's PBI type has
no Original Estimate field at all. Effort (`Microsoft.VSTS.Scheduling.Effort`)
is on the form and filled on 9 of 60 recent PBIs, and on 38 of 41 Bugs. Azure
DevOps documents Effort as "a subjective measure of the size", with no unit,
like Story Points and Size. Whether a team means hours by it is a team
convention, not something the API says. Today an original estimate typed in
Ajour on a PBI stays local: the plugin finds that the type lacks the field and
skips the push without reporting it (`buildAzureWorkItemUpdates`), and Ajour
keeps treating it as an edit to upload (`estimateFieldsToPush`). This comes
from reading the code, not from a test.

## What Azure DevOps offers to map types

All four calls answered on the work org with a Work Items Read token.

| Call                                                   | What it gives                                                                                                                                                                                                 |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET {project}/_apis/wit/workitemtypecategories`       | Each type's category: Requirement, Task, Bug, Feature, Epic, Hidden, and test categories. In the work org, Defect is in the Task category, and Suggestion and Feature Blocker in Requirement.                 |
| `GET {project}/_apis/work/processconfiguration`        | `typeFields`: the project's Effort field (Effort here, Story Points in Agile, Size in CMMI), its Remaining Work field and its Activity field. Also which types are on the task, requirement and bug backlogs. |
| `GET {project}/_apis/wit/workitemtypes`                | Each type's `color`, `icon.id` and `icon.url`, its fields, and `xmlForm`, the form definition. The form lists the HTML text fields in order, so the first one is the type's main text. Bug's is Repro Steps.  |
| `GET _apis/wit/workitemicons/{icon}?color={color}&v=2` | The type's icon as SVG, as Azure DevOps draws it. Not tried.                                                                                                                                                  |

WIQL can also filter by category, such as
`[System.WorkItemType] IN GROUP 'Microsoft.RequirementCategory'`, which #364
asked to check.

For processes the work org doesn't use, Microsoft's field reference says
([numeric fields](https://learn.microsoft.com/en-us/azure/devops/boards/queries/query-numeric?view=azure-devops),
[field index](https://learn.microsoft.com/en-us/azure/devops/boards/work-items/guidance/work-item-field?view=azure-devops)):

| Process | Backlog item and its effort field | Bug text                                   | Task estimates                          |
| ------- | --------------------------------- | ------------------------------------------ | --------------------------------------- |
| Basic   | Issue, Effort                     | No Bug type                                | _unverified_                            |
| Agile   | User Story, Story Points          | Repro Steps                                | Original Estimate, Remaining, Completed |
| Scrum   | Product Backlog Item, Effort      | Repro Steps                                | Remaining Work only                     |
| CMMI    | Requirement, Size                 | Symptom, Steps to Reproduce (_unverified_) | Original Estimate, Remaining, Completed |

The work org's process changed Scrum's Task: it added Original Estimate and
Completed Work, and made Original Estimate required. So type names don't
predict fields across organizations, and the type metadata above is the
reliable source.

## Where this meets existing tickets

- #335 is the spec that syncs every type. It says the type "is only a label"
  and stays a chip. A per-type field mapping fits that rule: the mapping
  changes which source field fills an Ajour field, not how the item behaves.
- #364 makes the Azure DevOps plugin query every type except hidden and test
  ones. The categories call answers its open question: it works on a real
  organization, and the work org's Hidden category holds Issue and User Story.

## Questions for the user

1. **How the mapping is set.** Per connection, per type, typed by the user. Or
   read from Azure DevOps (category, effort field, first form text field),
   with a per-type override in the connection settings.
2. **Effort as an estimate.** Whether Effort on a PBI or a Bug means hours on
   the user's teams, so it can fill Ajour's original estimate.
3. **Text write-back.** Whether Ajour writes an edited description back to
   Repro Steps on a Bug, or keeps a mapped text field read-only at first.
4. **The type indicator.** Azure DevOps' own color and icon per type, or a
   small set of Ajour kinds (such as bug, task, backlog item, feature) that
   GitHub and Jira can also map to.

## Outside the scope

- The query takes the 200 items changed last, done or not. 556 items are
  assigned to the user. Today all 21 open ones are in the 200, the oldest at
  position 147. An open item nobody touches can drop out of the window as the
  user closes others.
- Ajour's `GLOSSARY.md` has no term for an item's type yet.

## Method

Read-only calls through the Azure CLI's `azure-devops` extension, which uses
the user's stored token: `az devops invoke` for type metadata, categories and
process configuration, `az boards query` for WIQL, and `workitemsbatch`
without a field list, so the answer holds every non-empty field. The scripts
printed field reference names and counts only.
