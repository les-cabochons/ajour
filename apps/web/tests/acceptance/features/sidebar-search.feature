Feature: Sidebar search and project filter
  The sidebar's Search box and project filter narrow its work list without
  changing the Backlog page.

  Background:
    Given I have backlog items in two projects
    When I open the Backlog workspace

  Scenario: Search the sidebar by item name and project name
    When I search the sidebar for "backup"
    Then the sidebar lists only "Backup pipeline"
    And the Backlog page still lists every item
    When I search the sidebar for "ajour"
    Then the sidebar lists only "Sidebar search"
    When I press Escape in the sidebar search
    Then the sidebar lists every backlog item
    And the sidebar Search button has focus

  Scenario: Filter the sidebar to one project
    When I filter the sidebar to the "Rideau" project
    Then the sidebar lists only "Backup pipeline"
    When I reload the app
    Then the sidebar lists only "Backup pipeline"
    When I filter the sidebar to all projects
    Then the sidebar lists every backlog item

  Scenario: Clear the sidebar search from the keyboard
    When I search the sidebar for "backup"
    And I clear the sidebar search from the keyboard
    Then the sidebar lists every backlog item
    And the empty sidebar search box has focus

  Scenario: Keep the query after opening a row from the overlay sidebar
    When I use a narrow desktop window
    And I show the sidebar
    And I search the sidebar for "backup"
    And I open "Backup pipeline" from the sidebar
    Then the sidebar is hidden
    When I show the sidebar
    Then the sidebar lists only "Backup pipeline"
