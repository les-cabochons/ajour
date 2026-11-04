Feature: Assign a backlog item to someone else when settling
  A plugin that assigns adds an Assignee field to the Settle dialog. It starts
  on whoever has the item, and the person picked goes to the source with the
  settle, once the Undo toast closes.

  Scenario: Hand the item to someone else
    Given I have a synced item assigned to Alex Trépanier whose plugin assigns
    When I open Settle on the assignee fixture
    Then the Settle Assignee field shows "Alex Trépanier"
    When I pick "Ana Silva" as the Settle assignee
    And I press Settle in the Settle dialog
    Then the Undo toast says "Assigned to Ana Silva and settled"
    And no assignee write occurs while Undo is available
    And the item shows "Ana Silva" as its assignee
    When the Undo toast closes on its own
    Then the source was asked to assign the item to "ana@contoso.com"

  Scenario: Put the item back in the team's pool
    Given I have a synced item assigned to Alex Trépanier whose plugin assigns
    When I open Settle on the assignee fixture
    And I pick "Unassigned" as the Settle assignee
    And I press Settle in the Settle dialog
    Then the Undo toast says "Unassigned and settled"
    And no assignee write occurs while Undo is available
    When the Undo toast closes on its own
    Then the source was asked to unassign the item

  Scenario Outline: Send an assignee change held for Sync review
    Given I have a synced item assigned to Alex Trépanier whose plugin assigns
    And the assignee fixture refuses the first settle because editing is off
    When I open Settle on the assignee fixture
    And I pick "<person>" as the Settle assignee
    And I press Settle in the Settle dialog
    Then no assignee write occurs while Undo is available
    When the Undo toast closes on its own
    Then Sync review lists the held assignee as "Assignee → <person>"
    When I send the held assignee change
    Then the next source write assigns "<id>"

    Examples:
      | person     | id              |
      | Ana Silva  | ana@contoso.com |
      | Unassigned | null            |

  Scenario: Undo takes the assignee back before anything is sent
    Given I have a synced item assigned to Alex Trépanier whose plugin assigns
    When I open Settle on the assignee fixture
    And I pick "Ana Silva" as the Settle assignee
    And I press Settle in the Settle dialog
    And I press Undo on the settle
    Then the item shows "Alex Trépanier" as its assignee
    And no assignee was sent to the source

  Scenario: A plugin that doesn't assign keeps the dialog as it was
    Given I have a synced item whose plugin doesn't assign
    When I open Settle on the assignee fixture
    Then the Settle dialog has no Assignee field
