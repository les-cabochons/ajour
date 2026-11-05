Feature: Confirm a parent Settle without losing its draft
  The workflow mapping determines closure, and the subitem choice, asked in the
  Settle form itself, never costs the draft.

  Background:
    Given I have a writable synced parent Settle fixture
    When I open the parent Settle dialog

  Scenario: Change the subitem choice without losing the draft
    When I choose source state "Closed" and priority "4" in Settle
    Then Settle warns that the mapped state archives the item
    When I leave the Settle subitems out
    Then the Settle draft still has source state "Closed" and priority "4"
    When I include the Settle subitems
    And I submit the parent Settle draft
    Then the Settle dialog closes and the parent is "archived"

  Scenario: Preserve the draft when the displayed subitem set changes
    When I choose source state "Closed" and priority "4" in Settle
    And another subitem arrives during the Settle choice
    Then Settle asks about 2 open subitems
    And the Settle draft still has source state "Closed" and priority "4"

  Scenario: A source Done category mapped to open does not warn of archiving
    When I choose source state "Waiting" and priority "4" in Settle
    Then Settle does not warn of archiving
    When I include the Settle subitems
    And I submit the parent Settle draft
    Then the Settle dialog closes and the parent is "settled"

  Scenario: Submit the displayed priority after a backlog refresh
    When the source changes the parent's priority to Urgent during Settle
    Then the Settle priority draft remains High
    When I include the Settle subitems
    And I submit the parent Settle draft
    Then Settle writes High against the refreshed Urgent priority

  Scenario: Retain an unlisted state draft after a backlog refresh
    When I reopen Settle on an unlisted source state
    Then the Settle state draft remains Unlisted
    When the source changes the parent's state to Active during Settle
    Then the Settle state draft remains Unlisted
    And Settle requires an available state before submitting
    When I choose source state "Waiting" and priority "2" in Settle
    And I include the Settle subitems
    And I submit the parent Settle draft
    Then Settle submits the selected Waiting state

  Scenario: Settle locally with an unchanged unlisted source state
    When I reopen Settle on an unlisted source state
    Then the Settle state draft remains Unlisted
    When I include the Settle subitems
    And I submit the parent Settle draft
    Then Settle submits the unchanged unlisted state locally

  Scenario: A long item title does not widen the Settle or Snooze dialog
    When I reopen Settle after the parent gets a long title
    Then the "Settle" dialog fits its width without a horizontal scroll
    When I open Snooze on the parent instead
    Then the "Snooze until" dialog fits its width without a horizontal scroll
