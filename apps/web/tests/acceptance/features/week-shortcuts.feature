Feature: Getting the week done
  The Week view says how to commit it, and its Grid cells and Days cards
  take hours the quick way: typed, copied and pasted.

  Scenario: The Week toolbar has a labeled Commit week button
    Given I have a week of saved entries
    When I open the Week Grid
    And I press the labeled Commit week button
    Then the Commit page opens for the week of 2026-10-05

  Scenario Outline: The command palette finds Commit week by "<word>"
    Given I have a week of saved entries
    When I open the Week Grid
    And I open the command palette
    And I search the command palette for "<word>"
    And I choose "Commit week" in the command palette
    Then the Commit page opens for the week of 2026-10-05

    Examples:
      | word   |
      | submit |
      | lock   |

  Scenario: Copy a Grid cell's hours and paste them on another day
    Given I have a week of saved entries
    And the page may read the clipboard
    When I open the Week Grid
    And I copy the "Code review" cell on Monday
    Then the clipboard holds "1:00"
    When I paste "2:15" on the "Code review" cell on Tuesday
    Then the "Code review" cell on Tuesday shows "2:15"

  Scenario: Paste keeps only what hours can hold in an open Grid cell
    Given I have a week of saved entries
    And the page may read the clipboard
    When I open the Week Grid
    And I type "1" in the "Code review" cell on Wednesday and paste "abc\n7"
    Then the "Code review" cell on Wednesday holds "17"

  Scenario: Pasting hours on a cell whose panel is open saves the panel first
    Given I have a week of saved entries
    And the page may read the clipboard
    When I open the Week Grid
    And I open the "Development" cell on Tuesday in the side panel
    And I change the side panel's note to "Login form, second pass"
    And I paste "2:15" on the "Development" cell on Tuesday
    Then the "Development" cell on Tuesday shows "2:15"
    And no entry editor is open
    And the entry "tue-dev" holds 2:15 with the note "Login form, second pass"

  Scenario: Pasting hours keeps the open panel while its draft is invalid
    Given I have a week of saved entries
    And the page may read the clipboard
    When I open the Week Grid
    And I open the "Development" cell on Tuesday in the side panel
    And I type "25" in the side panel's Hours
    And I paste "2:15" on the "Development" cell on Tuesday
    Then the side panel still has the Hours "25:00"
    And the entry "tue-dev" holds 1:00 with the note "Login form"

  Scenario: A Grid cell with several entries says why it takes no typed hours
    Given I have a week of saved entries
    When I open the Week Grid
    And I type "3" on the "Development" cell on Monday
    Then the "Development" cell on Monday explains "2 entries share this cell. Change their hours in the panel."
    When I press "Open entries" under the cell
    Then the side panel lists the cell's 2 entries

  Scenario: An empty week copies last week's rows without their hours
    Given I have a week of saved entries
    When I open the Week Grid of the week after
    And I press "Copy last week's rows"
    Then the Grid has the rows "Development" and "Code review" with no time

  Scenario: Typing hours on a selected Days card edits that card's hours
    Given I have a week of saved entries
    When I open the Week Days
    And I click Tuesday's "Login form" card
    And I type "1:15" and press Enter
    Then Tuesday's "Login form" card shows "1:15"
    And no entry editor is open

  Scenario: A Days card keeps hours it can't save when another card is selected
    Given I have a week of saved entries
    When I open the Week Days
    And I click Tuesday's "Login form" card
    And I type "25" and press Enter
    Then Tuesday's "Login form" card says "An entry can be at most 24:00"
    When I click Monday's "API" card
    Then Tuesday's "Login form" card holds "25" and says "An entry can be at most 24:00"

  Scenario: A digit on another Days card does not replace hours that can't be saved
    Given I have a week of saved entries
    When I open the Week Days
    And I click Tuesday's "Login form" card
    And I type "25" and press Enter
    And I focus Monday's "API" card and type "2"
    Then Tuesday's "Login form" card holds "25" and says "An entry can be at most 24:00"
    When I press Escape in the cell
    And I focus Monday's "API" card and type "2"
    Then Monday's "API" card is being edited

  Scenario: The Commit page says how much the running entry adds
    Given I have a committed week of entries
    And an entry has run for 2 hours today
    When I open the Commit page for this week
    Then the Commit page notes "The running entry's 2:00 isn't counted until it stops."
