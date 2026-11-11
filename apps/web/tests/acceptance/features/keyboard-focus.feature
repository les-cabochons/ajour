Feature: Keyboard focus keeps the user's place
  After an edit, a pick, a move or a closed dialog, focus stays on what the
  user worked on, or moves to its neighbour when it left the list. The next
  key never acts on the wrong thing.

  Background:
    Given I have a workspace for keyboard work

  Scenario: Renaming a backlog item keeps focus on its title
    When I open the backlog item "Write release notes"
    And I rename the item to "Write the 1.4 release notes" with Enter
    Then focus is on the item's title
    When I press the "e" key
    Then the backlog item "Write the 1.4 release notes" is still open and active

  Scenario: Picking a priority with the row's keys keeps focus on the row
    When I focus the Backlog row "Fix the login form"
    And I press the "p" key
    Then the open menu highlights "Medium" and checks it
    When I press the "ArrowDown" key
    And I press the "Enter" key
    Then the Backlog row "Fix the login form" shows the priority "Low"
    And focus is on the Backlog row "Fix the login form"
    When I press the "p" key
    And I press the "Escape" key
    Then focus is on the Backlog row "Fix the login form"

  Scenario: Typing part of a state's name picks it in the state menu
    When I focus the Backlog row "Fix the login form"
    And I press the "Shift+S" key
    Then the open menu highlights "To do" and checks it
    When I type "rev" in the open menu and press Enter
    Then the Backlog row "Fix the login form" is in the "In review" group
    And focus is on the Backlog row "Fix the login form"

  Scenario: Moving a row to the next state keeps focus on it
    When I focus the Backlog row "Fix the login form"
    And I press the "Alt+ArrowRight" key
    Then the Backlog row "Fix the login form" is in the "In progress" group
    And focus is on the Backlog row "Fix the login form"

  Scenario: Settling a row moves focus to the next row
    When I focus the Backlog row "Fix the login form"
    And I press the "e" key
    Then the Backlog has no row "Fix the login form"
    And focus is on the Backlog row "Write release notes"

  Scenario: Creating a backlog item puts focus on its new row
    When I create the backlog item "Draft the changelog" from the Backlog page
    Then focus is on the Backlog row "Draft the changelog"

  Scenario: Creating an entry with N puts focus on its new row
    When I open today's Day view for keyboard work
    And I press the "n" key
    And I create an entry of "0:30" with the note "Pairing" from the open editor
    Then focus is on today's entry row "Pairing"

  Scenario: Stopping the running entry from the dock keeps focus in the dock
    Given an entry is running on Atlas Development
    When I open the Backlog page for keyboard work
    And I open the running entry from the dock and press Stop
    Then focus is on the dock's Start button

  Scenario: Stopping the running entry on the Time page keeps focus on its row
    Given an entry is running on Atlas Development
    When I open today's Day view for keyboard work
    And I open the running entry's row and press Stop
    Then focus is on today's entry row "Pairing on the export"

  Scenario: Moving an entry to another day moves focus to the next row
    When I open today's Day view for keyboard work
    And I move today's entry "Standup notes" to yesterday from its menu
    Then focus is on today's entry row "Sync bug"

  Scenario: Closing "Week complete" returns focus to the new entry
    Given one more half hour completes my week
    When I open today's Day view for keyboard work
    And I press the "n" key
    And I create an entry of "0:30" with the note "Pairing" from the open editor
    Then Ajour asks whether to commit the complete week
    When I press the "Escape" key
    Then focus is on today's entry row "Pairing"

  Scenario: Opening a project in the task menu highlights its first task
    When I open today's Day view for keyboard work
    And I press the "n" key
    And I open the editor's Project or task menu with the keyboard
    And I type "harb" in the task menu
    And I press the "Enter" key
    Then the task menu highlights "Development"
    When I press the "Enter" key
    Then the editor's Project or task reads "Harbor mobile · Development"

  Scenario: Recent tasks name their project
    When I open today's Day view for keyboard work
    And I press the "n" key
    And I open the editor's Project or task menu with the keyboard
    Then Recent tasks lists "Development" in "[ATL] Atlas platform" and "Development" in "[HRB] Harbor mobile"

  Scenario: Skip to content is the first Tab stop
    When I open today's Day view for keyboard work
    And I press the "Tab" key
    Then focus is on the "Skip to content" link
    When I press the "Enter" key
    Then focus is on today's first entry row

  Scenario: Each sidebar backlog row is one Tab stop
    When I open today's Day view for keyboard work
    And I focus the sidebar row "Fix the login form"
    And I press the "Tab" key
    Then the sidebar row "Write release notes" has focus

  Scenario: A double-click on Create entry opens nothing behind the editor
    When I open today's Day view for keyboard work
    And I press the "n" key
    And I type "0:30" in the open editor's Hours
    And I double-click the open editor's "Create entry" button
    Then no entry editor opens

  Scenario: A double-click on a row's Continue opens nothing behind it
    When I open today's Day view for keyboard work
    And I double-click Continue on today's entry row "Standup notes"
    Then no entry editor opens
    And today's entry row "Standup notes" is running

  Scenario: Clicking New project again focuses its composer
    When I open the Projects page for keyboard work
    And I click "New project" twice
    Then focus is in the New project composer's "Full name" field

  Scenario: Single keys stay quiet while a composer floats over the page
    When I open the Projects page for keyboard work
    And I click "New project" once
    And I click the page behind the composer
    And I press the "n" key
    Then no entry editor opens
    And the New project composer is still open

  Scenario: A Grid cell ignores S while an entry editor is open
    Given an entry is running on Atlas Development
    When I open an entry from the Week Grid for keyboard work
    And I focus another cell of the Week Grid
    And I press the "s" key
    Then the entry on Atlas Development is still running

  Scenario: The Settle dialog opens on its state
    Given a synced item "Fix export rounding" whose Settle asks
    When I open the backlog item "Fix export rounding"
    And I press the "Shift+E" key
    Then the Settle dialog has focus on its State
