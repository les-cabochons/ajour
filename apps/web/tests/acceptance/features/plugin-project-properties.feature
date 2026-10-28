Feature: Properties that plugins add to projects and tasks

  Scenario: Override a Workday name and undo it
    Given I have projects with searchable tasks
    And the Workday (agent) plugin adds project properties
    When I open project "aaa xyz"
    Then the "Workday" section is collapsed
    When I open the "Workday" section
    Then "Workday name" shows the default "aaa xyz"
    And "Workday code" shows the default "AAA"
    When I set "Workday name" to "CA004 Tech & Design"
    Then "Workday name" shows "CA004 Tech & Design"
    When I press Undo on the toast
    Then "Workday name" shows the default "aaa xyz"

  Scenario: Map a task to a Workday task
    Given I have projects with searchable tasks
    And the Workday (agent) plugin adds task properties
    When I open project "aaa xyz"
    And I map task "111 000" to the Workday task "222 000" and save
    Then task "111 000" shows the Workday task "222 000"
    And task "111 000" is saved with the Workday task "222 000"
