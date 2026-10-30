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

  Scenario: The editor's Save writes the level at once, with no Undo
    When I change the synced item's priority to "Medium" in the editor and save
    Then the item's source received priority "medium" and no state at once
    And no Undo toast showed

  Scenario: The editor disables No priority, with the reason
    When I open the priority field of the synced item's editor
    Then the editor's "No priority" is disabled with the reason "Ajour can't clear the priority in its source."

  Scenario: With editing off, Sync review lists the held change as its level
    Given editing work items is off on the synced item's connection
    When I change the synced item's priority to "Medium"
    And the Undo toast closes on its own
    Then the change is held on this computer
    And Sync review lists the synced item's held change as "Priority Medium"
