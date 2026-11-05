Feature: Create a task from a task picker
  A task picker creates a task its project doesn't have yet, named so a
  later import of the same task updates it.

  Scenario: Create a task from a backlog item's Task property and undo it
    Given a backlog item is on a project without the task "07 Run"
    When I open that item's page
    And I type "07 Run" in the item's Task property
    Then the Task list offers "Create task \"07 Run\""
    When I press Enter
    Then the item's Task shows "07 Run"
    And a toast says "Task 07 Run created"
    When I press Undo on the toast
    Then the item's Task shows "No task"
    And the project has no task "07 Run"

  Scenario: Restore an archived task instead of adding a twin
    Given a backlog item is on a project without the task "07 Run"
    When I open that item's page
    And I type "08 old" in the item's Task property
    Then the Task list offers "Restore task \"08 Old\""
    When I press Enter
    Then the item's Task shows "08 Old"

  Scenario: Create a task inside a project in the time entry task menu
    Given a backlog item is on a project without the task "07 Run"
    When I open today's time workspace
    And I open the new time-entry project and task picker
    And I open "[ACME] Acme website" in the task menu
    And I type "07 Run" in the task menu
    And I press Enter
    Then the picker shows "Acme website · 07 Run"

  Scenario: Create a task from the task menu's start view with a project
    Given a backlog item is on a project without the task "07 Run"
    When I open today's time workspace
    And I open the new time-entry project and task picker
    And I type "Temp migration" in the task menu
    And I press Enter
    Then the Create task dialog asks for a project for "Temp migration"
    When I pick the project "Acme website" in the dialog
    And I press "Create task"
    Then the picker shows "Acme website · Temp migration"

  Scenario: A task import asks which new task a Not known yet task waited for
    Given project "Acme website" has a Not known yet task "Temp migration"
    When I open project "Acme website"
    And I import the task file with two new tasks
    Then Ajour asks which task "Temp migration" was waiting for, suggesting "08 Migration"
    When I press "Import"
    Then the project lists "08 Migration" once and "07 Run"
    And the import says "Imported 1 task. Matched 1 waiting task."
