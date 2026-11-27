Feature: Time rounding
  Each entry's time rounds by the rule picked in Settings, and only the
  rounded time is shown and committed.

  Scenario: A short timer saves as a quarter hour
    Given I have a committed week of entries
    And an entry has run for 7 minutes today
    When I pick "Up to 15 minutes" for Rounding in Settings
    Then Rounding says "0:07 saves as 0:15 · 0:52 as 1:00"
    When I close Settings
    And I stop the running entry
    And I open today's Day list
    Then today's "Long session" entry shows "0:15"
    And this week's Commit page shows "0:15" for the added "Long session"
