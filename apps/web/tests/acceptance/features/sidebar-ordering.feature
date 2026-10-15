Feature: Sidebar ordering
  With Custom ordering, the sidebar's backlog rows move by drag or by
  Alt+Up and Alt+Down. The filter menu switches between Custom and Priority,
  which is the Backlog page's ordering too.

  Background:
    Given I have backlog items with priorities
    When I open the Backlog workspace

  Scenario: Drag a sidebar row with Custom ordering
    When I drag the sidebar row "Loose note" above "Sidebar search"
    Then the sidebar reads "Loose note", "Sidebar search", "Backup pipeline"
    When I reload the app
    Then the sidebar reads "Loose note", "Sidebar search", "Backup pipeline"

  Scenario: Move a sidebar row from the keyboard
    When I press Alt+Down on the sidebar row "Sidebar search"
    Then the sidebar reads "Backup pipeline", "Sidebar search", "Loose note"
    And the sidebar row "Sidebar search" has focus

  Scenario: Switch the sidebar between Custom and Priority
    When I order the sidebar by "Priority"
    Then the sidebar reads "Backup pipeline", "Sidebar search", "Loose note"
    When I drag the sidebar row "Loose note" above "Backup pipeline"
    Then the sidebar reads "Backup pipeline", "Sidebar search", "Loose note"
    When I order the sidebar by "Custom"
    Then the sidebar reads "Sidebar search", "Backup pipeline", "Loose note"
