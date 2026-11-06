Feature: Typed durations
  Every hours field reads the formats the app shows and the common ones, and
  refuses absurd values with a message where they were typed.

  Scenario: The entry editor reads common formats and refuses more than a day
    Given I have no saved Ajour workspace
    When I open a new entry from the titlebar on the Backlog page
    And I type "1h30" in Hours
    Then Hours shows no message
    When I type "90" in Hours
    Then Hours says "An entry can be at most 24:00"
    And Save is disabled
    When I type "24:00" in Hours
    Then Hours shows no message

  Scenario: The phone keyboard for Hours has the colon and the point
    Given I have no saved Ajour workspace
    When I open a new entry from the titlebar on the Backlog page
    Then Hours asks the phone for a keyboard with ":", "." and letters

  Scenario Outline: A Grid cell reads "<typed>" as <hours>
    Given I have a week of saved entries
    When I open the Week Grid
    And I type "<typed>" in the "Code review" cell on Tuesday and press Enter
    Then the "Code review" cell on Tuesday shows "<hours>"

    Examples:
      | typed | hours |
      | .5    | 0:30  |
      | ,5    | 0:30  |
      | :45   | 0:45  |
      | 1h30  | 1:30  |
      | 90m   | 1:30  |
      | 2h    | 2:00  |

  Scenario: A Grid cell refuses more than a day with a message
    Given I have a week of saved entries
    When I open the Week Grid
    And I type "130" in the "Code review" cell on Tuesday and press Enter
    Then the "Code review" cell on Tuesday says "An entry can be at most 24:00"
    When I press Enter again
    Then the "Code review" cell on Tuesday still says "An entry can be at most 24:00"
    When I press Escape in the cell
    Then the "Code review" cell on Tuesday is empty

  Scenario: A Grid cell says how to write hours it can't read
    Given I have a week of saved entries
    When I open the Week Grid
    And I type "1x" in the "Code review" cell on Tuesday and press Enter
    Then the "Code review" cell on Tuesday says "Enter hours, such as 1:30, 1.5 or 1h30"

  Scenario: A Grid cell refuses negative hours typed straight on it
    Given I have a week of saved entries
    When I open the Week Grid
    And I type "-1" in the "Code review" cell on Tuesday and press Enter
    Then the "Code review" cell on Tuesday says "Enter hours, such as 1:30, 1.5 or 1h30"

  Scenario: A Grid cell keeps hours it can't save when focus leaves it
    Given I have a week of saved entries
    When I open the Week Grid
    And I type "90" in the "Code review" cell on Tuesday and click the Grid's header
    Then the "Code review" cell on Tuesday keeps "90" and says "An entry can be at most 24:00"
    When I double-click the "Code review" cell on Wednesday
    Then the "Code review" cell on Tuesday says "An entry can be at most 24:00"
    When I press Escape in the cell
    And I double-click the "Code review" cell on Wednesday
    Then the "Code review" cell on Wednesday is being edited

  Scenario: A huge entry saved before the limit keeps the week readable
    Given I have a week with an entry of a million hours
    When I open the Week Grid
    Then no figure runs out of its cell
    When I switch the Week view to Days
    Then no figure runs out of its cell
    When I open the Day view of that entry
    Then no figure runs out of its cell
    When I narrow the window to a phone
    Then no figure runs out of its cell

  Scenario: Daily capacity commits on Enter and stops at a day
    Given I have no saved Ajour workspace
    When I open Settings General
    And I type "6" in the Monday capacity and press Enter
    Then the Monday capacity is saved as "6:00"
    When I type "25" in the Monday capacity and press Enter
    Then the Monday capacity says "A day can hold at most 24:00"
    And the Monday capacity is saved as "6:00"
    When I type "7h30" in the Monday capacity and press Enter
    Then the Monday capacity is saved as "7:30"

  Scenario: A task budget reads common formats and refuses absurd hours
    Given I have projects with searchable tasks
    When I open project "aaa xyz"
    And I open task "111 000"
    And I type "1h30" in the task's budget
    Then the task editor shows no budget message
    When I type "99999999" in the task's budget
    Then the task editor says "Budget: Enter at most 100,000 hours"
    When I type "-2h" in the task's adjustment
    Then the task editor shows no adjustment message

  Scenario: A new backlog item's estimate reads common formats and refuses absurd hours
    Given I have a backlog view fixture
    When I open the Backlog workspace
    And I start a new backlog item
    And I type "2,5" in its estimate
    Then the composer shows no estimate message
    When I type "1h30" in its estimate
    Then the composer shows no estimate message
    When I type "1e2" in its estimate
    Then the composer says "Original: Enter hours, such as 1:30, 1.5 or 1h30"
    When I type "9999999" in its estimate
    Then the composer says "Original: Enter at most 100,000 hours"

  Scenario: An estimate on the item page says why it refuses what was typed
    Given I have a backlog view fixture
    When I open the Backlog parent page
    And I type "1e2" in its remaining estimate on its page and press Enter
    Then the remaining estimate on its page says "Enter hours, such as 1:30, 1.5 or 1h30"
    When I type "1h30" in its remaining estimate on its page and press Enter
    Then its remaining estimate on its page reads "1h30"
