Feature: Never lose a draft, and undo more than one step
  Escape closes a composer and keeps its draft, leaving the Time page saves a
  valid draft, and Cmd+Z walks back through every undoable action.

  Background:
    Given I have a week of saved entries

  Scenario: Cmd+Z walks back through several deletes
    When I open Monday in the Day view
    And I delete the Monday entry "API"
    And I delete the Monday entry "Login form"
    And I press Cmd+Z 3 times
    Then Monday's entries are back exactly as they were

  Scenario: Saving an entry's hours offers Undo
    When I open Monday in the Day view
    And I open the Monday entry "API"
    And I type "3:00" in Hours and press Enter
    Then a toast says "Entry saved" with Undo
    When I undo with the toast button
    Then the Monday entry "API" has 2:00 hours

  Scenario: A Grid cell's hours offer Undo
    When I open the Week Grid
    And I type "4" in the "Code review" cell on Monday and press Enter
    Then a toast says "Entry saved" with Undo
    When I undo with the Cmd+Z shortcut
    Then the Monday entry "mon-review" has 1:00 hours

  Scenario: Creating an entry offers Undo
    When I open Monday in the Day view
    And I write a new entry of "1:00" with the note "Planning"
    And I press Enter in the note
    Then a toast says "Entry created" with Undo
    When I undo with the Cmd+Z shortcut
    Then Monday has no entry "Planning"

  Scenario: Opening another composer saves the draft with Undo
    When I open Monday in the Day view
    And I open the Monday entry "API"
    And I add " and tests" to the note
    And I open a new entry from the timer dock "+"
    Then a toast says "Entry saved" with Undo
    And the new entry form is open
    When I undo with the toast button
    Then the Monday entry "mon-dev-2" has the note "API"

  Scenario: Escape closes a new entry and keeps its draft
    When I open Monday in the Day view
    And I write a new entry of "1:00" with the note "Planning"
    And I press Escape in the note
    Then no entry editor is open
    And Monday has no entry "Planning"
    When I press the "n" key
    Then the entry editor shows "1:00" and the note "Planning"
    When I press Cancel in the entry editor
    And I press the "n" key
    Then the entry editor shows "" and the note ""

  Scenario: Escape in the narrow view's dialog keeps a new entry's draft
    Given the window is 390 pixels wide
    When I open Monday in the Day view
    And I write a new entry of "1:00" with the note "Planning"
    And I press Escape in the note
    Then no entry editor is open
    And Monday has no entry "Planning"
    When I press the "n" key
    Then the entry editor shows "1:00" and the note "Planning"

  Scenario: Escape keeps a saved entry's unsaved note
    When I open Monday in the Day view
    And I open the Monday entry "API"
    And I add " and tests" to the note
    And I press Escape in the note
    Then no entry editor is open
    And the Monday entry "mon-dev-2" has the note "API"
    When I open the Monday entry "API"
    Then the entry editor shows "2:00" and the note "API and tests"

  Scenario: Leaving the Time page saves a valid new entry
    When I open Monday in the Day view
    And I write a new entry of "1:00" with the note "Planning"
    And I open Backlog from the app sidebar
    Then the Backlog workspace is open
    And a toast says "Entry created" with Undo
    And Monday has an entry "Planning" of 1:00

  Scenario: Leaving the Time page keeps an invalid new entry as a draft
    When I open Monday in the Day view
    And I write a new entry of "1x" with the note "Planning"
    And I open Backlog from the app sidebar
    Then the Backlog workspace is open
    And Monday has no entry "Planning"
    When I go back in the browser
    Then the entry editor shows "1x" and the note "Planning"
    When I press Cancel in the entry editor
    And I press the "n" key
    Then the entry editor shows "" and the note ""

  Scenario: Enter on a note with no hours does not stop the running entry
    Given an entry is running on "Development"
    When I open Monday in the Day view
    And I write a new entry of "" with the note "only a note"
    And I press Enter in the note
    Then the entry editor says "Enter hours, or press Start. Start stops the running entry."
    And the entry on "Development" is still running
    When I press Start in the entry editor
    Then the running entry has the note "only a note"

  Scenario: Escape keeps a new project's draft
    When I open the Projects workspace
    And I open the New project composer
    And I type "Northwind" as the new project's full name and press Escape
    Then the project composer is closed
    And there is no project "Northwind"
    When I open the New project composer
    Then the new project's full name reads "Northwind"
    When I cancel the project composer
    And I open the New project composer
    Then the new project's full name reads ""

  Scenario: A kept draft takes in the hours another tab changed
    When I open Monday in the Day view
    And I open the Monday entry "API"
    And I add " and tests" to the note
    And I press Escape in the note
    And another tab sets the Monday entry "mon-dev-2" to 3:00 hours
    And I open the Monday entry "API"
    Then the entry editor shows "3:00" and the note "API and tests"
    And the entry editor shows no changed field
    When I press Enter in the note
    Then the Monday entry "mon-dev-2" has 3:00 hours
    And the Monday entry "mon-dev-2" has the note "API and tests"

  Scenario: A kept draft shows a field that another tab changed too
    When I open Monday in the Day view
    And I open the Monday entry "API"
    And I change Hours to "1:30"
    And I press Escape in the note
    And another tab sets the Monday entry "mon-dev-2" to 4:00 hours
    And I open the Monday entry "API"
    Then the entry editor shows "1:30" and the note "API"
    And the entry editor says "Hours changed"
    And the entry editor says "Now 4:00. Your draft has 1:30."
    And the entry editor's Save is disabled
    When I press "Use theirs" in the entry editor
    Then the entry editor shows "4:00" and the note "API"
    And the entry editor shows no changed field

  Scenario: Keeping my version of a changed field lets the draft save
    When I open Monday in the Day view
    And I open the Monday entry "API"
    And I change Hours to "1:30"
    And I press Escape in the note
    And another tab sets the Monday entry "mon-dev-2" to 4:00 hours
    And I open the Monday entry "API"
    And I press "Keep mine" in the entry editor
    And I press Enter in the note
    Then the Monday entry "mon-dev-2" has 1:30 hours

  Scenario: An open time entry takes in the hours another tab changed
    When I open Monday in the Day view
    And I open the Monday entry "API"
    And I add " and tests" to the note
    And another tab sets the Monday entry "mon-dev-2" to 3:00 hours
    Then the entry editor shows "3:00" and the note "API and tests"
    And the entry editor shows no changed field
    When I press Enter in the note
    Then the Monday entry "mon-dev-2" has 3:00 hours
    And the Monday entry "mon-dev-2" has the note "API and tests"

  Scenario: An open time entry shows a field another tab changed too
    When I open Monday in the Day view
    And I open the Monday entry "API"
    And I change Hours to "1:30"
    And another tab sets the Monday entry "mon-dev-2" to 4:00 hours
    Then the entry editor shows "1:30" and the note "API"
    And the entry editor says "Hours changed"
    And the entry editor says "Now 4:00. Your draft has 1:30."
    And the entry editor's Save is disabled
    When I press "Use theirs" in the entry editor
    Then the entry editor shows "4:00" and the note "API"
    And the entry editor shows no changed field

  Scenario: A change that lands as I press Save is not written over
    When I open Monday in the Day view
    And I open the Monday entry "API"
    And I add " and tests" to the note
    And another tab sets the Monday entry "mon-dev-2" to 3:00 hours as I press Save
    Then the Monday entry "mon-dev-2" has 3:00 hours
    And the Monday entry "mon-dev-2" has the note "API and tests"

  Scenario: A hours change that conflicts as I press Save is not written over
    When I open Monday in the Day view
    And I open the Monday entry "API"
    And I change Hours to "1:30"
    And another tab sets the Monday entry "mon-dev-2" to 4:00 hours as I press Save
    Then the Monday entry "mon-dev-2" has 4:00 hours
    And the entry editor says "Hours changed"

  Scenario: The open running entry takes in the note another tab changed
    Given an entry is running on "Development"
    When I open Monday in the Day view
    And I open the running entry from the timer dock
    And I change Hours to "2:00"
    And another tab sets the running entry's note to "Elsewhere"
    Then the entry editor shows "2:00" and the note "Elsewhere"
    And the entry editor shows no changed field
    When I press Enter in the note
    Then the running entry has the note "Elsewhere"

  Scenario: An open project form takes in the name another tab changed
    When I open the Projects workspace
    And I open the project form of "Client Atlas" from its row menu
    And I type "ATL" as the project's code
    And another tab renames project "project-atlas" to "Atlas elsewhere"
    Then the project form's full name reads "Atlas elsewhere"
    And the project form's code reads "ATL"
    And the project form shows no changed field
    When I press "Save" in the project form
    Then the stored project "project-atlas" is named "Atlas elsewhere" with the code "ATL"

  Scenario: An open project form shows a field another tab changed too
    When I open the Projects workspace
    And I open the project form of "Client Atlas" from its row menu
    And I type "Atlas draft" as the project's full name
    And another tab renames project "project-atlas" to "Atlas elsewhere"
    Then the project form says "Full name changed"
    And the project form says "Now Atlas elsewhere. Your draft has Atlas draft."
    And the project form's Save is disabled

  Scenario: A rename that lands as I press Save is not written over
    When I open the Projects workspace
    And I open the project form of "Client Atlas" from its row menu
    And I type "ATL" as the project's code
    And another tab renames project "project-atlas" to "Atlas elsewhere" as I press Save in the project form
    Then the stored project "project-atlas" is named "Atlas elsewhere" with the code "ATL"

  Scenario: An open task editor takes in the budget another tab changed
    When I open project "Client Atlas"
    And I open task "Development"
    And I type "Dev draft" as the task's name
    And another tab sets the budget of task "task-dev" to 3 hours
    Then the task editor's name reads "Dev draft"
    And the task editor's budget reads "3h"
    When I press "Save" in the task editor
    Then the stored task "task-dev" is named "Dev draft" with a budget of 3 hours

  Scenario: A budget that lands as I press Save in the task editor is not written over
    When I open project "Client Atlas"
    And I open task "Development"
    And I type "Dev draft" as the task's name
    And another tab sets the budget of task "task-dev" to 3 hours as I press Save in the task editor
    Then the stored task "task-dev" is named "Dev draft" with a budget of 3 hours
