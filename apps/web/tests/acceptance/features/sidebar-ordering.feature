Feature: Sidebar ordering
  The sidebar's backlog rows move by drag or by Alt+Up and Alt+Down. With
  Priority ordering, a row moves within its level, and a drag shows the
  levels so a drop can change one. The filter menu switches between Custom
  and Priority, which is the Backlog page's ordering too.

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
    And the sidebar shows no levels
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

  Scenario: Open the gap where the drop puts a pinned parent's subitem
    Given "Backup pipeline" has a subitem "Pipeline alerts" with its own priority
    When I pin "Backup pipeline" from the sidebar
    Then the sidebar reads "Backup pipeline", "Sidebar search", "Pipeline alerts", "Loose note"
    When I start dragging the sidebar row "Sidebar search" below "Loose note"
    Then the sidebar shows "Backup pipeline", "Loose note", "Pipeline alerts", the gap from top to bottom
    When I drop the dragged row
    Then the sidebar reads "Backup pipeline", "Loose note", "Pipeline alerts", "Sidebar search"

  Scenario: Open the gap where the drop puts a subitem whose parent the search hides
    Given "Backup pipeline" has a subitem "Pipeline alerts" with its own priority
    When I search the sidebar for "s"
    Then the sidebar reads "Sidebar search", "Pipeline alerts", "Loose note"
    When I start dragging the sidebar row "Sidebar search" below "Loose note"
    Then the sidebar shows "Loose note", "Pipeline alerts", the gap from top to bottom
    When I drop the dragged row
    Then the sidebar reads "Loose note", "Pipeline alerts", "Sidebar search"

  Scenario: Move a sidebar row from the keyboard
    When I press Alt+Down on the sidebar row "Sidebar search"
    Then the sidebar reads "Backup pipeline", "Sidebar search", "Loose note"
    And the sidebar row "Sidebar search" has focus

  Scenario: Switch the sidebar between Custom and Priority
    When I order the sidebar by "Priority"
    Then the sidebar reads "Backup pipeline", "Sidebar search", "Loose note"
    When I order the sidebar by "Custom"
    Then the sidebar reads "Sidebar search", "Backup pipeline", "Loose note"

  Scenario: Reorder a sidebar row within its priority level
    Given the item "Loose note" is "Medium"
    When I order the sidebar by "Priority"
    Then the sidebar reads "Backup pipeline", "Sidebar search", "Loose note"
    When I drag the sidebar row "Loose note" above "Sidebar search"
    Then the sidebar reads "Backup pipeline", "Loose note", "Sidebar search"
    And "Loose note" is now "Medium"
    And the Backlog page reads "Backup pipeline", "Loose note", "Sidebar search"

  Scenario: Show the levels while a row drags with Priority ordering
    When I order the sidebar by "Priority"
    And I start dragging the sidebar row "Loose note" above "Sidebar search"
    Then the sidebar shows the levels "Urgent", "High", "Medium", "Low", "No priority" with "Medium" highlighted
    When I cancel the drag with Escape
    Then the sidebar shows no levels
    And the sidebar reads "Backup pipeline", "Sidebar search", "Loose note"

  Scenario: Drop a sidebar row in another level, then undo
    When I order the sidebar by "Priority"
    And I drag the sidebar row "Loose note" above "Sidebar search"
    Then the sidebar reads "Backup pipeline", "Loose note", "Sidebar search"
    And "Loose note" is now "Medium"
    When I press Undo on the toast
    Then the sidebar reads "Backup pipeline", "Sidebar search", "Loose note"
    And "Loose note" is now "No priority"

  Scenario: Drop a sidebar row on a level nothing has yet
    When I order the sidebar by "Priority"
    And I drag the sidebar row "Loose note" onto the level "High"
    Then "Loose note" is now "High"
    And the sidebar reads "Backup pipeline", "Loose note", "Sidebar search"

  Scenario: Pick up a sidebar row and drop it in place with Priority ordering
    When I order the sidebar by "Priority"
    And I pick up the sidebar row "Sidebar search" and drop it in place
    Then "Sidebar search" is now "Medium"
    And the sidebar reads "Backup pipeline", "Sidebar search", "Loose note"

  Scenario: Drop on a level's label after it moved with the gap
    Given the item "Sidebar search" is "High"
    And the item "Loose note" is "Low"
    When I order the sidebar by "Priority"
    And I start dragging the sidebar row "Backup pipeline" onto the level "Medium", following its label
    Then the sidebar shows the levels "Urgent", "High", "Medium", "Low", "No priority" with "Medium" highlighted
    When I drop the dragged row
    Then "Backup pipeline" is now "Medium"

  Scenario: Keep a synced item whose source has a priority out of No priority
    Given the item "Sidebar search" comes from a source that has its priority
    When I order the sidebar by "Priority"
    And I start dragging the sidebar row "Sidebar search" onto the level "No priority"
    Then no level is highlighted
    When I drop the dragged row
    Then "Sidebar search" is now "Medium"
    And the sidebar reads "Backup pipeline", "Sidebar search", "Loose note"

  Scenario: Move a sidebar row from the keyboard within its level
    Given the item "Loose note" is "Medium"
    When I order the sidebar by "Priority"
    And I press Alt+Up on the sidebar row "Loose note"
    Then the sidebar reads "Backup pipeline", "Loose note", "Sidebar search"
    When I press Alt+Up on the sidebar row "Loose note"
    Then the sidebar reads "Backup pipeline", "Loose note", "Sidebar search"
    And "Loose note" is now "Medium"

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

  Scenario: Reorder a pinned row within its level with Priority ordering
    Given the item "Loose note" is "Urgent"
    When I pin "Backup pipeline" from the sidebar
    And I pin "Loose note" from the sidebar
    And I order the sidebar by "Priority"
    Then the sidebar reads "Backup pipeline", "Loose note", "Sidebar search"
    When I start dragging the sidebar row "Loose note" above "Backup pipeline"
    Then the sidebar shows no levels
    When I drop the dragged row
    Then the sidebar reads "Loose note", "Backup pipeline", "Sidebar search"
    And "Loose note" is now "Urgent"
    And "Loose note" is still pinned

  Scenario: Reorder while the sidebar search narrows the list
    When I search the sidebar for "n"
    Then the sidebar reads "Backup pipeline", "Loose note"
    When I drag the sidebar row "Loose note" above "Backup pipeline"
    Then the sidebar reads "Loose note", "Backup pipeline"
    When I press Escape in the sidebar search
    Then the sidebar reads "Sidebar search", "Loose note", "Backup pipeline"
