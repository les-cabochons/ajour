Feature: Connection fields by item type

  Scenario: A field set for one item type is saved and shown again
    Given a connection whose synced items are 2 Tasks and a Bug
    When I edit the connection
    Then the rows by item type are "Task, 2 items" and "Bug, 1 item"
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
