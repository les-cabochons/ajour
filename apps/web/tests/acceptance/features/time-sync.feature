Feature: Time entries sync through a time sync plugin

  Scenario: Time entries starts off, and stays off when the plugin refuses the connection's token
    Given the example planner is connected, and refuses a token that can only read for time entries
    When I open the example planner's settings
    Then the example planner's Time entries switch is off
    When I turn on time entries for the example planner
    Then Settings says "Planner: Time entries need a token that can write. This one can only read."
    And the example planner's Time entries switch is off
