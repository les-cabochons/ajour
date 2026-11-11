Feature: Finding backlog items and making new ones
  The Backlog page and the command palette find an item by the words, number
  or key its row shows, and a new item made under a filter stays in sight.

  Background:
    Given I have backlog items synced with their numbers
    When I open the Backlog workspace

  Scenario Outline: Search the Backlog page for "<query>"
    When I search the Backlog page for "<query>"
    Then the Backlog page shows only "<title>"

    Examples:
      | query    | title                                |
      | 48190    | Week grid: keyboard editing of cells |
      | #48190   | Week grid: keyboard editing of cells |
      | HRB-412  | Harbor: offline sync conflict dialog |
      | weekgrid | Week grid: keyboard editing of cells |

  Scenario: Text typed in Filter by… searches the rows
    When I open the Backlog filters
    And I type "weekgrid" in Filter by
    And I choose Search for "weekgrid"
    Then the Backlog search box holds "weekgrid"
    And the Backlog page shows only "Week grid: keyboard editing of cells"

  Scenario Outline: Open an item from the command palette by "<query>"
    When I open the command palette
    And I search the command palette for "<query>"
    And I press Enter in the command palette
    Then the item page of "<title>" is open

    Examples:
      | query   | title                                |
      | #48190  | Week grid: keyboard editing of cells |
      | HRB-412 | Harbor: offline sync conflict dialog |

  Scenario: The command palette on an item page lists that item's actions
    When I open the item page of "Week grid: keyboard editing of cells"
    And I open the command palette
    Then the command palette's first section is "Week grid: keyboard editing of cells"

  Scenario: Cmd+K closes the command palette it opened
    When I open the command palette
    And I press Cmd+K
    Then the command palette is closed

  Scenario: Make a backlog item from the command palette
    When I open the command palette
    And I search the command palette for "new backlog"
    And I choose "New backlog item" in the command palette
    Then the new backlog item form is open

  Scenario: A new item takes the project of the active filter
    When I open the Backlog filters
    And I pick the "Project" filter "Harbor mobile"
    And I make the backlog item "Filtered new" from the page
    Then the Backlog page shows "Filtered new"
    And "Filtered new" is in project "Harbor mobile"

  Scenario: A new item the filters hide says so and offers to show it
    When I open the Backlog filters
    And I pick the "Priority" filter "Urgent"
    And I pick the "Priority" filter "High"
    And I make the backlog item "Hidden new" from the page
    Then a toast says "“Hidden new” is hidden by the filters"
    When I press Show in the toast
    Then the Backlog page shows "Hidden new"
    And the Backlog has no filters

  Scenario: Show on a new subitem that Display hides leaves the matching filter
    When I open the Backlog filters
    And I pick the "Project" filter "Atlas platform"
    And I turn off Show subitems in Display
    And I add the subitem "Hidden child" to "Week grid: keyboard editing of cells"
    Then a toast says "“Hidden child” is hidden by the"
    When I press Show in the toast
    Then the Backlog page shows "Hidden child"
    And the Backlog still filters by "Project"
