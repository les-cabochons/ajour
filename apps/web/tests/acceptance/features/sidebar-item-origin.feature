Feature: Open a backlog item from the sidebar outside Backlog
  An item opened from the sidebar while Time or Projects shows keeps that view
  selected, and its back link returns to the page it was opened from.

  Background:
    Given I have backlog items in two projects

  Scenario: Return to the Time week view from a backlog item
    When I open the Time week view
    And I open "Backup pipeline" from the sidebar
    Then the sidebar view switcher shows "Time"
    And the item page offers "Back to Time"
    When I follow the item page's back link
    Then the Time week view is open

  Scenario: Return to Projects from a backlog item
    When I open the Projects page
    And I open "Backup pipeline" from the sidebar
    And I open "Sidebar search" from the sidebar
    Then the sidebar view switcher shows "Projects"
    When I follow the item page's back link
    Then the Projects page is open

  Scenario: An item opened from Backlog returns to Backlog
    When I open the Backlog workspace
    And I open "Backup pipeline" from the sidebar
    Then the sidebar view switcher shows "Backlog"
    And the item page offers "Back to Backlog"
