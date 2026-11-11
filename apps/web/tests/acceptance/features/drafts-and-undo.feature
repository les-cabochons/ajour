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
    And I click the Day view's empty space
    And I press the "n" key
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
