Feature: The entry editor's main button and the Week's day list

  The entry editor has one main button, which Enter also presses. A new
  entry reads Start until it has hours, then Create entry. A saved entry
  reads Continue until any field changes, then Save. Start and Continue count
  on today, so on another day they read "Start today". On the Week, the side
  panel lists the entries of the form's date under the form.

  Scenario: A new entry starts until it has hours, then creates
    Given I have no saved Ajour workspace
    When I open a new entry from the titlebar on the Backlog page
    Then the entry's main button reads "Start"
    And the entry editor hints "Enter hours, or press Start"
    When I type "1:30" in the entry's Hours
    Then the entry's main button reads "Create entry"

  Scenario: An untouched entry continues today
    Given I have an entry logged today with the note "Today's work"
    When I open this week's Days view
    And I double-click today's card "Today's work"
    Then the entry's main button reads "Continue"

  Scenario: An untouched entry from another day starts today, and Enter presses it
    Given I have a week of saved entries
    When I open the Week Days view
    And I double-click Monday's "API" card
    Then the entry's main button reads "Start today"
    When I press Enter in Hours
    Then a running entry with the note "API" counts today

  Scenario: Any edit turns the main button into Save
    Given I have a week of saved entries
    When I open the Week Days view
    And I double-click Monday's "API" card
    And I change the entry's note to "API docs"
    Then the entry's main button reads "Save"

  Scenario: The Week's side panel lists the day of the entry it edits
    Given I have a week of saved entries
    When I open the Week Days view
    And I double-click Monday's "API" card
    Then the panel lists "Monday, October 5" for 4:00: "Login form", "API", "Code review"
    And the panel's list marks "API" as the open entry
    When I move the entry's date to "2026-10-06"
    Then the panel lists "Tuesday, October 6" for 1:00: "Login form", "This entry"
    When I open "Login form" from the panel's list
    Then the side panel edits the entry "tue-dev"
    And Monday's "API" entry is saved on Tuesday
