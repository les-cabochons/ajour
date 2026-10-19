Feature: Commit the week
  The Commit page lists what changed since the last commit, and marks the
  checked changes as committed.

  Scenario: Commit part of a week's changes
    Given I have a committed week of entries
    When I open the Commit page for the week of 2026-10-05
    Then the Commit page says everything is committed
    When I delete Monday's "Login form" entry
    And I change Monday's "API" entry to "2:30" hours
    And I duplicate Tuesday's "Spec review" entry
    And I open the Commit page for the week of 2026-10-05
    Then the Commit page lists 3 changes
    And each change kind shows its own symbol
    And the "Updated" change shows "2:00 → 2:30"
    When I uncheck the "Deleted" change
    And I press "Mark as committed"
    Then the Commit page lists only the "Deleted" change
    When I undo with the toast button
    Then the Commit page lists 3 changes

  Scenario: Mark an entry as not committed after the timesheet changed
    Given I have a committed week of entries
    When I mark Monday's "API" entry as not committed
    And I open the Commit page for the week of 2026-10-05
    Then the Commit page lists only an "Updated" change for "API"
    When I press "Mark as committed"
    Then the Commit page says everything is committed

  Scenario: Mark every selected entry as not committed
    Given I have a committed week of entries
    When I open Monday's Day list
    And I click the "Login form" entry
    And I Cmd-click the "API" entry
    And I choose "Mark 2 entries as not committed" from the "API" entry's menu
    Then a toast says "Marked 2 entries as not committed"
    When I open the Commit page for the week of 2026-10-05
    Then the Commit page lists 2 changes

  Scenario: Collapse the Changes section
    Given I have a committed week of entries
    When I mark Monday's "API" entry as not committed
    And I open the Commit page for the week of 2026-10-05
    And I collapse the Changes section
    Then the Commit page shows no change rows
    And "Mark as committed" is still on the Commit page
    When I expand the Changes section
    Then the Commit page lists only an "Updated" change for "API"

  Scenario: Copy a line under its Workday name
    Given I have a committed week of entries
    And the Workday (agent) plugin adds project properties
    When I open the Commit page for the week of 2026-10-05
    Then Monday's "Development" line shows "Client Atlas / Development"
    When I show line names from "Workday"
    Then Monday's "Development" line shows "CA004 Tech & Design / Development"
    When I copy the project and task of Monday's "Development" line
    Then the clipboard holds "CA004 Tech & Design Development"
    When I open the Commit page for the week of 2026-10-05
    Then Monday's "Development" line shows "CA004 Tech & Design / Development"

  Scenario: Open the Commit page from the sidebar
    Given I have a committed week of entries
    When I open Monday's Day list
    And I press "Commit week"
    Then the Commit page says everything is committed

  Scenario: Open the Commit page from the top bar while the sidebar is hidden
    Given I have a committed week of entries
    When I open Monday's Day list
    And I hide the app sidebar with its button
    And I press Commit week in the top bar
    Then the Commit page says everything is committed

  Scenario: The totals show the day total and no Commit button
    Given I have a committed week of entries
    When I open Monday's Day list
    Then the titlebar totals read "3:00"
    And the totals popover has no Commit button
    When I open today's Day list
    Then the titlebar totals read "Today 0:00"

  Scenario: Ask to commit once the week reaches its target
    Given I have a committed week of entries
    And my weekly target is 5 hours, all on Monday
    When I duplicate Tuesday's "Spec review" entry
    Then Ajour asks "Week complete": "You logged 5:00 of 5:00 for the week of Oct 5 to 11. Commit and lock it now?"
    When I answer "Commit"
    Then the Commit page for the week of 2026-10-05 is open
    When I delete Monday's "Login form" entry
    And I undo with the toast button
    Then Monday's "Login form" entry is back
    And Ajour does not ask again
