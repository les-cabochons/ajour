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
