Feature: Hide non-working days
  Time views can hide days whose configured capacity is zero.

  Scenario: Hide zero-capacity days across time layouts and restore them
    Given I have time logged on working and non-working days
    When I enable hiding non-working days with Wednesday off and Saturday working
    Then the day strip and both Week layouts show only the five working days
    And the narrow day strip shows only the five working days
    When I disable hiding non-working days
    Then the day strip and Week grid show all seven days again

  Scenario: Hide every day when no capacity is configured
    Given I have time logged on working and non-working days
    When I enable hiding non-working days with Wednesday off and Saturday working
    And I set every daily capacity to zero
    Then the Week view explains that every day is hidden
