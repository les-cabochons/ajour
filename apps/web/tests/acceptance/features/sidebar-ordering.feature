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

  Scenario: Make room for a dragged sidebar row
    When I start dragging the sidebar row "Loose note" above "Sidebar search"
    Then the sidebar shows "Loose note" once
    And the sidebar shows the gap, "Sidebar search", "Backup pipeline" from top to bottom
    When I cancel the drag with Escape
    Then the sidebar shows "Sidebar search", "Backup pipeline", "Loose note" from top to bottom
    And the sidebar reads "Sidebar search", "Backup pipeline", "Loose note"

  Scenario: Drop a sidebar row in the gap, then undo
    When I start dragging the sidebar row "Sidebar search" below "Backup pipeline"
    Then the sidebar shows "Backup pipeline", the gap, "Loose note" from top to bottom
    When I drop the dragged row
    Then the sidebar reads "Backup pipeline", "Sidebar search", "Loose note"
    When I press Undo on the toast
    Then the sidebar reads "Sidebar search", "Backup pipeline", "Loose note"

  Scenario: Drop a sidebar row back in its own place
    When I pick up the sidebar row "Backup pipeline" and drop it in place
    Then the sidebar reads "Sidebar search", "Backup pipeline", "Loose note"
    And no Undo toast showed

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

  Scenario: Pick the ordering from the keyboard
    When I order the sidebar by "Priority" from the keyboard
    Then the sidebar reads "Backup pipeline", "Sidebar search", "Loose note"

  Scenario: Show neither ordering pressed when the Backlog page picked another
    When I order the Backlog by "created"
    And I open the sidebar filter menu
    Then neither sidebar ordering is pressed

  Scenario: Keep a pinned row among the pinned rows
    When I pin "Loose note" from the sidebar
    Then the sidebar reads "Loose note", "Sidebar search", "Backup pipeline"
    When I drag the sidebar row "Backup pipeline" above "Loose note"
    Then the sidebar reads "Loose note", "Sidebar search", "Backup pipeline"

  Scenario: Reorder while the sidebar search narrows the list
    When I search the sidebar for "n"
    Then the sidebar reads "Backup pipeline", "Loose note"
    When I drag the sidebar row "Loose note" above "Backup pipeline"
    Then the sidebar reads "Loose note", "Backup pipeline"
    When I press Escape in the sidebar search
    Then the sidebar reads "Sidebar search", "Loose note", "Backup pipeline"
