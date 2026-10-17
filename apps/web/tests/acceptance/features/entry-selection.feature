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
