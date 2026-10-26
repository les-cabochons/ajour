# Schemas read imported files as sheets

A schema plugin declared datasets with typed columns, and Ajour read an imported workbook against them: one worksheet per dataset, named after it, with the column headers in row 1. That fits a file Ajour wrote. It doesn't fit a file another tool exported. Workday's project export ("Afficher un projet") has 21 worksheets: the project's name and ID sit as label and value pairs in the Récapitulatif sheet, and its tasks start under a title, at row 5 of Ressources des tâches. Workday's project plan export names no project at all.

So a schema's `importProjects` gets every worksheet of the file as rows of cells, and finds its data itself. Ajour still reads the file: the plugin gets text, numbers, booleans and nulls, never bytes. The datasets stay, and now describe only the export layout. A schema without them only imports, and Settings offers no export with it. An imported project may leave out its name when the file doesn't hold it. Ajour then takes the file only from Import tasks… on a project, which puts the tasks into that project.

## Considered options

- **Teach the datasets more layouts**, such as a header row other than 1 and label and value pairs. Rejected. Each new export from another tool would need a new layout in Ajour, and Workday alone already needs two.
- **Hand the plugin the file's bytes.** Rejected. The plugin would bundle an Excel reader, and Ajour would no longer control what a plugin parses.
- **Send only the worksheets the manifest names.** Rejected for now. Workday names worksheets in the user's language, and the plan export's worksheet name is cut at 31 characters. The cells stay on the user's machine, and a schema gets no network once it runs on plugin API 4 (#401).

## Consequences

- A schema checks the layout of what it imports and words its own errors, such as `Row 4 is invalid. "Fermé" must be Oui or Non.` The message never quotes a cell, since Ajour records it in its events.
- Ajour checks only the size of an imported file: at most 100 worksheets, 100,000 rows per worksheet and 1,000 cells per row.
- Ajour's built-in schema still reads its own `Projects` worksheet against its columns.
- Import tasks… on a project uses the schema picked in Settings › Projects when it is a plugin. With Ajour default, it reads task names from column C of the first worksheet, as before.
