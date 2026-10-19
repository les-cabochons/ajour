Feature: Select, copy, cut and paste time entries
  A click selects an entry as in a file explorer, and a double click opens it.
  Copy and cut act on every selected entry. Paste puts them on the shown day,
  or on the same weekdays of the shown week.

  Scenario: Select an entry with a click and open it with a double click
    Given I have a week of saved entries
    When I open Monday's Day list
    And I click the "API" entry
    Then only the "API" entry is selected
    And no entry editor is open
    When I double-click the "API" entry
    Then the side panel edits the "API" entry

  Scenario: Copy two entries to another day
    Given I have a week of saved entries
    When I open Monday's Day list
    And I click the "API" entry
    And I Cmd-click the "Login form" entry
    And I press the "ControlOrMeta+c" key
    And I go to Thursday in the day strip
    And I press the "ControlOrMeta+v" key
    Then the Day list reads "Login form", "API"
    And a toast says "Pasted 2 entries"
    When I go to Monday in the day strip
    Then the Day list reads "Login form", "API", "Code review"

  Scenario: Copy and paste an entry from its right-click menu
    Given I have a week of saved entries
    When I open Monday's Day list
    And I right-click the "API" entry and choose "Copy"
    And I right-click the "Code review" entry and choose "Paste"
    Then the Day list reads "Login form", "API", "Code review", "API"
    And a toast says "Pasted 1 entry"

  Scenario: Paste from the menu skips entries once something else was copied
    Given I have a week of saved entries
    And the page may read the clipboard
    When I open Monday's Day list
    And I right-click the "API" entry and choose "Copy"
    And another app copies "Lunch order"
    And I right-click the "Code review" entry and choose "Paste"
    And I right-click the "API" entry and choose "Copy"
    And I right-click the "Login form" entry and choose "Paste"
    Then the Day list reads "Login form", "API", "Code review", "API"

  Scenario: Delete every selected entry at once
    Given I have a week of saved entries
    When I open Monday's Day list
    And I click the "Code review" entry
    And I Shift-click the "API" entry
    And I press the "Backspace" key
    Then the Day list reads "Login form"
    And a toast says "2 entries deleted"

  Scenario: Delete the selection, not the entry Cmd-click just deselected
    Given I have a week of saved entries
    When I open Monday's Day list
    And I click the "Code review" entry
    And I Cmd-click the "API" entry
    And I Cmd-click the "API" entry
    And I press the "Backspace" key
    Then the Day list reads "Login form", "API"

  Scenario: Leaving a day clears its selection
    Given I have a week of saved entries
    When I open Monday's Day list
    And I click the "API" entry
    And I go to Tuesday in the day strip
    And I go to Monday in the day strip
    Then no entry is selected

  Scenario: Cut a range of cards and paste them on the same weekdays of the next week
    Given I have a week of saved entries
    When I open the Week Days view
    And I click Monday's "Login form" card
    And I Shift-click Tuesday's "Login form" card
    And I press the "ControlOrMeta+x" key
    Then 4 cards are dimmed as cut
    When I press the "]" key
    And I press the "ControlOrMeta+v" key
    Then Monday's cards read "Login form", "API", "Code review"
    And Tuesday's cards read "Login form"
    And a toast says "Moved 4 entries"
    When I press the "[" key
    Then Monday has no cards

  Scenario: Paste copied cards into the column under the pointer
    Given I have a week of saved entries
    When I open the Week Days view
    And I click Tuesday's "Login form" card
    And I press the "ControlOrMeta+c" key
    And I right-click Thursday's column and choose "Paste here"
    Then Thursday's cards read "Login form"
    And Tuesday's cards read "Login form"
