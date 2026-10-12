Feature: Browse plugin capabilities
  Background:
    Given I have no saved Ajour workspace
    And the catalog contains a plugin with connector and code host capabilities

  Scenario Outline: Keep every catalog filter reachable
    When I open the catalog at <width> pixels wide
    Then all four plugin filters fit inside the viewport

    Examples:
      | width |
      | 320   |
      | 390   |
      | 1280  |

  Scenario: List a plugin under every capability it provides
    When I open the plugins catalog
    And I select the "Connectors" plugin filter
    Then the combined plugin appears with its connector and code host badge
    And the GitHub catalog entry is hidden
    When I select the "Code hosts" plugin filter
    Then the combined plugin appears with its connector and code host badge
    And the GitHub catalog entry offers a download
    When I select the "Schemas" plugin filter
    Then the Workday schema is the only catalog entry
