Feature: Properties that plugins add to projects and tasks

  Scenario: Override a Workday name and undo it
    Given I have projects with searchable tasks
    And the Workday (agent) plugin adds project properties
    When I open project "aaa xyz"
    Then the "Workday" section is collapsed
    When I open the "Workday" section
    Then "Workday name" says "Same as full name", the default "aaa xyz"
    And "Workday code" says "Same as code", the default "AAA"
    When I set "Workday name" to "CA004 Tech & Design"
    Then "Workday name" shows "CA004 Tech & Design"
    When I press Undo on the toast
    Then "Workday name" says "Same as full name", the default "aaa xyz"

  Scenario: Map a task to a Workday task
    Given I have projects with searchable tasks
    And the Workday (agent) plugin adds task properties
    When I open project "aaa xyz"
    And I map task "111 000" to the Workday task "222 000" and save
    Then task "111 000" shows the Workday task "222 000"
    And task "111 000" is saved with the Workday task "222 000"

  Scenario: Mark a task Not known yet, then Local only
    Given I have projects with searchable tasks
    And the Workday (agent) plugin adds task properties
    When I open project "aaa xyz"
    And I map task "111 000" to the Workday task "222 000" and save
    And I set task "111 000" to commit as "Not known yet" and save
    Then task "111 000" shows the chip "Not known yet"
    And task "111 000" has no Workday task any more
    When I set task "111 000" to commit as "Local only" and save
    Then task "111 000" shows the chip "Local"

  Scenario: Make a project local only and undo it
    Given I have projects with searchable tasks
    And the Workday (agent) plugin adds task properties
    When I open project "aaa xyz"
    And I set the project's "Workday" row to "Local only"
    Then task "111 000" says its project is local only
    When I press Undo on the toast
    Then task "111 000" offers Commits as

  Scenario: Another task… waits for a task before Save
    Given I have projects with searchable tasks
    And the Workday (agent) plugin adds task properties
    When I open project "aaa xyz"
    And I set task "111 000" to commit as "Not known yet" and save
    And I choose Another task… for task "111 000" without picking one
    Then Save is disabled and says "Pick the task it commits as."
    And task "111 000" still shows the chip "Not known yet"

  Scenario: Create the Workday task from Another task…
    Given I have projects with searchable tasks
    And the Workday (agent) plugin adds task properties
    When I open project "aaa xyz"
    And I map task "111 000" to a new Workday task "07 Run" and save
    Then task "111 000" shows the Workday task "07 Run"
    And task "07 Run" is in the project's task list

  Scenario: Undo of a created Workday task refuses once the mapping is saved
    Given I have projects with searchable tasks
    And the Workday (agent) plugin adds task properties
    When I open project "aaa xyz"
    And I map task "111 000" to a new Workday task "07 Run" and save
    And I press Undo on the toast
    Then a toast says "Can't undo. 07 Run is in use now. Archive it instead."
    And task "07 Run" is in the project's task list

  Scenario: Undo of a created Workday task leaves another task's draft alone
    Given I have projects with searchable tasks
    And the Workday (agent) plugin adds task properties
    When I open project "aaa xyz"
    And I map task "111 000" to a new Workday task "07 Run" and cancel
    And I open task "222 000" in the task editor
    And I press Undo on the toast
    Then the open task editor has Commits as "Its own name"
    And task "07 Run" is not in the project's task list
