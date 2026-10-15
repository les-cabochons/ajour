Feature: Confirm a parent Settle without losing its draft
  The workflow mapping determines closure and cancelled subitem choices preserve the draft.

  Background:
    Given I have a writable synced parent Settle fixture
    When I open the parent Settle dialog

  Scenario: Cancel and retry the subitem choice with the same draft
    When I choose source state "Closed" and priority "4" in Settle
    Then Settle warns that the mapped state archives the item
    When I submit the parent Settle draft
    And I cancel the Settle subitem choice
    Then the Settle draft still has source state "Closed" and priority "4"
    When I submit the parent Settle draft
    And I include the Settle subitems
    Then the Settle dialog closes and the parent is "archived"

  Scenario: Preserve the draft when the displayed subitem set changes
    When I choose source state "Closed" and priority "4" in Settle
    And I submit the parent Settle draft
    And another subitem arrives during the Settle choice
    And I include the Settle subitems
    Then the Settle draft still has source state "Closed" and priority "4"

  Scenario: A connector Done category mapped to open does not warn of archiving
    When I choose source state "Waiting" and priority "4" in Settle
    Then Settle does not warn of archiving
    When I submit the parent Settle draft
    And I include the Settle subitems
    Then the Settle dialog closes and the parent is "settled"

  Scenario: Submit the displayed priority after a connector refresh
    When the source changes the parent's priority to Urgent during Settle
    Then the Settle priority draft remains High
    When I submit the parent Settle draft
    And I include the Settle subitems
    Then Settle writes High against the refreshed Urgent priority

  Scenario: Retain an unlisted state draft after a connector refresh
    When I reopen Settle on an unlisted source state
    Then the Settle state draft remains Unlisted
    When the source changes the parent's state to Active during Settle
    Then the Settle state draft remains Unlisted
    And Settle requires an available state before submitting
    When I choose source state "Waiting" and priority "2" in Settle
    And I submit the parent Settle draft
    And I include the Settle subitems
    Then Settle submits the selected Waiting state

  Scenario: Settle locally with an unchanged unlisted source state
    When I reopen Settle on an unlisted source state
    Then the Settle state draft remains Unlisted
    When I submit the parent Settle draft
    And I include the Settle subitems
    Then Settle submits the unchanged unlisted state locally

  Scenario: A long item title does not widen the Settle dialog
    When I reopen Settle after the parent gets a long title
    Then the Settle dialog fits its width without a horizontal scroll
