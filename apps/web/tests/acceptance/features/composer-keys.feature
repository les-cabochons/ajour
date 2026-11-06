Feature: Save a composer from any of its fields

  Scenario: Create a backlog item with Ctrl+Enter from its description
    Given I have a synced backlog item "Fix export rounding" from Azure DevOps ticket 48213
    When I open the Backlog workspace
    And I start a new backlog item "Write the release notes" with the description "Draft them from the changelog"
    And I press Ctrl+Enter in the new item's description
    Then the new item composer is closed
    And "Write the release notes" is in the Backlog

  Scenario: Create a project with Ctrl+Enter, and see where its code goes
    Given I have projects with searchable tasks
    When I open the Projects workspace
    And I open the New project composer
    Then its empty Code field shows its "ATL" placeholder
    When I name the new project "Northwind" and press Ctrl+Enter
    Then the project composer is closed
