Feature: Submit the week
  Submit week locks a committed week, so its entries stay as they went to the
  timesheet tool. Reopen week unlocks it.

  Scenario: Submit a committed week under pace, then undo it
    Given I have a committed week of entries
    When I open the Commit page for the week of 2026-10-05
    And I press "Submit week"
    Then the pace check says "You logged 4:00 of the 40:00 expected by now."
    When I press "Submit anyway"
    Then a toast says "Week submitted"
    And the Commit page shows the week is submitted
    When I undo with the toast button
    Then the Commit page shows the week is not submitted

  Scenario: Submit week waits until every change is committed
    Given I have a committed week of entries
    When I change Monday's "API" entry to "2:30" hours
    And I open the Commit page for the week of 2026-10-05
    Then "Submit week" is disabled with the reason "Commit your changes first"
    When I press "Mark as committed"
    And I press "Submit week"
    And I press "Submit anyway"
    Then the Commit page shows the week is submitted
    When I press "Reopen week"
    Then a toast says "Week reopened"
    And the Commit page shows the week is not submitted

  Scenario: A submitted week is read-only until it is reopened
    Given I have a committed week of entries
    When I open the Commit page for the week of 2026-10-05
    And I press "Submit week"
    And I press "Submit anyway"
    And I open Monday's Day list
    And I double-click the "API" entry
    Then the entry editor is read-only
    When I right-click the "Login form" entry
    Then "Delete" is disabled in the menu with the reason "The week of 2026-10-05 is submitted. Reopen it to change it."
    When I open the Week Days view
    Then the Week view shows the week is submitted
    When I open the Commit page for the week of 2026-10-05
    And I press "Reopen week"
    And I change Monday's "API" entry to "2:30" hours
    And I open the Commit page for the week of 2026-10-05
    Then the Commit page lists 1 changes
