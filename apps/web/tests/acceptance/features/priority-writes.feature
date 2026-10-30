Feature: Priority changes on synced items write to the source
  A synced item's new priority level goes to its source when the Undo toast
  closes, as a move's state does (#471, ADR 0015).

  Background:
    Given a synced item with High priority whose plugin writes

  Scenario: The picked level is written once the Undo toast closes
    When I change the synced item's priority to "Medium"
    Then nothing was written to the item's source yet
    When the Undo toast closes on its own
    Then the item's source received priority "medium" and no state

  Scenario: Undo before the toast closes writes nothing
    When I change the synced item's priority to "Medium"
    And I press Undo on the toast
    Then the synced item's priority is High with no write waiting
    And nothing was written to the item's source yet

  Scenario: No priority is disabled, with the reason
    When I open the synced item's priority picker
    Then the picker's "No priority" is disabled with the reason "Ajour can't clear the priority in its source."
