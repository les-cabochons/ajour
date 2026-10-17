Feature: Select time entries like a file explorer
  The Day list and the Week Days cards select like Finder. A press on an
  unselected entry selects it at once, opening an entry's menu selects it
  first, Cmd+A selects every shown entry, and Shift+arrows extend the range.

  Scenario: A press on an unselected entry selects it before the button comes up
    Given I have a week of saved entries
    When I open Monday's Day list
    And I click the "API" entry
    And I Cmd-click the "Login form" entry
    And I press the mouse on the "Code review" entry
    Then only the "Code review" entry is selected
    When I release the mouse
    Then only the "Code review" entry is selected

  Scenario: A press on a selected entry keeps the selection until the click
    Given I have a week of saved entries
    When I open Monday's Day list
    And I click the "API" entry
    And I Cmd-click the "Login form" entry
    And I press the mouse on the "API" entry
    Then 2 entries are selected
    When I release the mouse
    Then only the "API" entry is selected

  Scenario: Right-click on an unselected entry selects it, and its menu acts on it alone
    Given I have a week of saved entries
    When I open Monday's Day list
    And I click the "API" entry
    And I Cmd-click the "Login form" entry
    And I right-click the "Code review" entry and choose "Delete"
    Then the Day list reads "Login form", "API"
    And a toast says "Entry deleted"

  Scenario: Right-click on a selected entry keeps the selection
    Given I have a week of saved entries
    When I open Monday's Day list
    And I click the "API" entry
    And I Cmd-click the "Login form" entry
    And I right-click the "API" entry and choose "Delete"
    Then the Day list reads "Code review"
    And a toast says "2 entries deleted"

  Scenario: Cmd+A selects every entry of the day
    Given I have a week of saved entries
    When I open Monday's Day list
    And I click the "API" entry
    And I press the "ControlOrMeta+a" key
    Then 3 entries are selected
    When I press the "Backspace" key
    Then the Day list is empty
    And a toast says "3 entries deleted"

  Scenario: The Edit menu's Select All selects every entry of the day
    Given I have a week of saved entries
    When I open Monday's Day list
    And I click the "API" entry
    And I choose Select All from the Edit menu
    Then 3 entries are selected

  Scenario: Shift+arrows extend the range and a plain arrow collapses it
    Given I have a week of saved entries
    When I open Monday's Day list
    And I click the "Login form" entry
    And I press the "Shift+ArrowDown" key
    And I press the "Shift+ArrowDown" key
    Then 3 entries are selected
    When I press the "Shift+ArrowUp" key
    Then 2 entries are selected
    When I press the "ArrowUp" key
    Then only the "Login form" entry is selected

  Scenario: A plain arrow at either end of the list still collapses the selection
    Given I have a week of saved entries
    When I open Monday's Day list
    And I click the "Login form" entry
    And I press the "ControlOrMeta+a" key
    And I press the "ArrowUp" key
    Then only the "Login form" entry is selected
    When I click the "Code review" entry
    And I press the "ControlOrMeta+a" key
    And I press the "ArrowDown" key
    Then only the "Code review" entry is selected

  Scenario: Shift+ArrowDown on the Week cards continues into the next day
    Given I have a week of saved entries
    When I open the Week Days view
    And I click Monday's "Code review" card
    And I press the "Shift+ArrowDown" key
    Then 2 cards are selected
    And Tuesday's "Login form" card is selected

  Scenario: The menu of a multiple selection names its count and drops single-entry actions
    Given I have a week of saved entries
    When I open Monday's Day list
    And I click the "API" entry
    And I Cmd-click the "Login form" entry
    And I right-click the "API" entry
    Then the menu lists "Duplicate 2 entries", "Duplicate 2 entries to…", "Move 2 entries to…", "Delete 2 entries"

  Scenario: M moves every selected entry to the chosen day
    Given I have a week of saved entries
    When I open Monday's Day list
    And I click the "API" entry
    And I Cmd-click the "Login form" entry
    And I press the "m" key
    And I choose October 8 in the "Move 2 entries" dialog
    Then the Day list reads "Code review"
    And a toast says "Moved 2 entries to Thu, Oct 8"
    When I go to Thursday in the day strip
    Then the Day list reads "Login form", "API"

  Scenario: M follows the selection, not the entry Cmd-click just deselected
    Given I have a week of saved entries
    When I open Monday's Day list
    And I click the "Code review" entry
    And I Cmd-click the "API" entry
    And I Cmd-click the "API" entry
    And I press the "m" key
    And I choose October 8 in the "Move time entry" dialog
    Then the Day list reads "Login form", "API"
    And a toast says "Moved to Thu, Oct 8"

  Scenario: Cmd+D duplicates every selected entry, and the copies become the selection
    Given I have a week of saved entries
    When I open Monday's Day list
    And I click the "Login form" entry
    And I Shift-click the "API" entry
    And I press the "ControlOrMeta+d" key
    Then the Day list reads "Login form", "API", "Code review", "Login form", "API"
    And a toast says "Duplicated 2 entries"
    And rows 4 and 5 of the Day list are selected

  Scenario: Cmd+D on the one selected entry selects the copy
    Given I have a week of saved entries
    When I open Monday's Day list
    And I click the "API" entry
    And I press the "ControlOrMeta+d" key
    Then the Day list reads "Login form", "API", "Code review", "API"
    And a toast says "Entry duplicated"
    And only row 4 of the Day list is selected

  Scenario: Duplicate a range of cards to another day from the menu
    Given I have a week of saved entries
    When I open the Week Days view
    And I click Monday's "Login form" card
    And I Shift-click Monday's "API" card
    And I right-click Monday's "API" card and choose "Duplicate 2 entries to…"
    And I choose October 7 in the "Duplicate 2 entries" dialog
    Then Wednesday's cards read "Login form", "API"
    And a toast says "Duplicated 2 entries to Wed, Oct 7"
    And 2 cards are selected
    And Wednesday's "API" card is selected

  Scenario: Pasted entries become the selection
    Given I have a week of saved entries
    When I open Monday's Day list
    And I click the "API" entry
    And I press the "ControlOrMeta+c" key
    And I go to Thursday in the day strip
    And I press the "ControlOrMeta+v" key
    Then only the "API" entry is selected

  Scenario: Dragging a selected card moves the whole selection to another day
    Given I have a week of saved entries
    When I open the Week Days view
    And I click Monday's "Login form" card
    And I Cmd-click Monday's "Code review" card
    And I start dragging Monday's "Code review" card onto Wednesday
    Then the drag preview counts 2 entries
    When I release the mouse
    Then Monday's cards read "API"
    And Wednesday's cards read "Login form", "Code review"
    And a toast says "Moved 2 entries to Wed, Oct 7"
    And 2 cards are selected

  Scenario: A selection from two days lands together at the drop line
    Given I have a week of saved entries
    When I open the Week Days view
    And I click Monday's "API" card
    And I Cmd-click Tuesday's "Login form" card
    And I drag Tuesday's "Login form" card above Monday's "Login form" card
    Then Monday's cards read "API", "Login form", "Login form", "Code review"
    And Tuesday has no cards
    And a toast says "Moved 1 entry to Mon, Oct 5"

  Scenario: Dragging an unselected card carries only that card
    Given I have a week of saved entries
    When I open the Week Days view
    And I click Monday's "Login form" card
    And I Cmd-click Monday's "Code review" card
    And I drag Monday's "API" card onto Wednesday
    Then Monday's cards read "Login form", "Code review"
    And Wednesday's cards read "API"
    And 1 cards are selected

  Scenario: Dragging selected rows reorders them as one block
    Given I have a week of saved entries
    When I open Monday's Day list
    And I click the "Login form" entry
    And I Cmd-click the "API" entry
    And I drag the "API" entry below the "Code review" entry
    Then the Day list reads "Code review", "Login form", "API"
    And 2 entries are selected
