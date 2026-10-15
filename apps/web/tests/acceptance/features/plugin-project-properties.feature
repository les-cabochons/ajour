Feature: Properties that plugins add to projects

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
