Feature: Connection fields by item type

  Scenario: A field set for one item type is saved and shown again
    Given a connection whose synced items are 2 Tasks and a Bug
    When I edit the connection
    Then the rows by item type are "Task, 2 items" and "Bug, 1 item"
    And Ajour didn't ask the plugin about item types
    When I set "Original estimate" of "Task, 2 items" to "Original Estimate"
    And I save the connection
    Then the connection was saved with the overrides '{"Task":{"originalEstimateFieldName":"Original Estimate"}}'
    When I edit the connection
    Then "Original estimate" of "Task, 2 items" shows "Original Estimate"

  Scenario: A type added by hand is saved with its field
    Given a connection whose synced items are 2 Tasks and a Bug
    When I edit the connection
    And I add the type "Defect"
    And I set "Original estimate" of "Defect" to "Original Estimate"
    And I save the connection
    Then the connection was saved with the overrides '{"Defect":{"originalEstimateFieldName":"Original Estimate"}}'

  Scenario: A type that lacks the connection's field takes the plugin's proposal
    Given an example tracker connection whose synced items are 2 Tasks, a Story, a Bug and a Spike
    When I edit the connection
    Then "Task, 2 items" says "Task has no Effort field."
    And "Original estimate" of "Task, 2 items" proposes "Original Estimate"
    And "Original estimate" of "Spike, 1 item" reads "none on this type"
    And "Task, 2 items" shows its icon
    And "Bug, 1 item" shows no icon
    When I use the proposal of "Task, 2 items"
    And I save the connection
    Then the connection was saved with the overrides '{"Task":{"originalEstimateFieldName":"Original Estimate"}}'

  Scenario: A proposal the user doesn't take is not saved
    Given an example tracker connection whose synced items are 2 Tasks, a Story, a Bug and a Spike
    When I edit the connection
    And I set "Remaining" of "Bug, 1 item" to "Remaining Hours"
    And I save the connection
    Then the connection was saved with the overrides '{"Bug":{"remainingEstimateFieldName":"Remaining Hours"}}'

  Scenario: Add a type offers the plugin's other types
    Given an example tracker connection whose synced items are 2 Tasks, a Story, a Bug and a Spike
    When I edit the connection
    And I pick the type "Epic" under Add a type
    Then "Epic" shows its icon
    When I set "Original estimate" of "Epic" to "Effort"
    And I save the connection
    Then the connection was saved with the overrides '{"Epic":{"originalEstimateFieldName":"Effort"}}'

  Scenario: A failing lookup leaves the rows editable
    Given an example tracker connection whose synced items are 2 Tasks, a Story, a Bug and a Spike
    And the example tracker can't describe its item types
    When I edit the connection
    Then the fields by item type say "Couldn't read the item types from Example tracker, so the rows show no icons or proposals."
    When I set "Original estimate" of "Task, 2 items" to "Original Estimate"
    And I save the connection
    Then the connection was saved with the overrides '{"Task":{"originalEstimateFieldName":"Original Estimate"}}'
