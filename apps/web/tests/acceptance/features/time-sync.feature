Feature: Time entries sync through a time sync plugin

  Scenario: Time entries starts off, and stays off when the plugin refuses the connection's token
    Given the example planner is connected, and refuses a token that can only read for time entries
    When I open the example planner's settings
    Then the example planner's Time entries switch is off
    When I turn on time entries for the example planner
    Then Settings says "Planner: Time entries need a token that can write. This one can only read."
    And the example planner's Time entries switch is off

  Scenario: An entry added, edited and deleted on a managed project reaches the planner within seconds
    Given the example planner manages "Acme - Support", with Time entries on
    When I log "1:30" on "Ticket #101 - Login" today
    Then the planner holds 90 minutes on "Ticket #101 - Login" today
    When I change today's "Ticket #101 - Login" entry to "2:00" hours
    Then the planner holds 120 minutes on "Ticket #101 - Login" today
    When I open the example planner's settings
    Then Settings says "Time entries · 1 sent"
    When I delete today's "Ticket #101 - Login" entry
    Then the planner holds no entry

  Scenario: A failed round shows the connection's toast, and the change goes through on the next round
    Given the example planner manages "Acme - Support", with Time entries on
    And the planner fails the next round that brings a change with "The planner is down."
    When I log "1:30" on "Ticket #101 - Login" today
    Then an error toast "Planner sync failed" says "The planner is down."
    And the planner holds 90 minutes on "Ticket #101 - Login" today

  Scenario: The running entry shows there as running, and a switch and Stop follow within seconds
    Given the example planner manages "Acme - Support", with Time entries on
    When I start an entry on "Ticket #101 - Login"
    And 2 minutes pass
    Then the planner shows "Ticket #101 - Login" running for 2 minutes
    When I switch to "Ticket #102 - Export"
    Then the planner shows "Ticket #101 - Login" stopped at 2 minutes, as the entry it showed running
    And the planner shows "Ticket #102 - Export" running
    When 3 minutes pass
    And I stop the running entry
    Then the planner shows "Ticket #102 - Export" stopped at 3 minutes, as the entry it showed running
  Scenario: An entry logged in another tool shows in the Day view, and follows its edit and delete there
    Given the example planner manages "Acme - Support", with Time entries on
    And another tool logged 45 minutes on "Ticket #101 - Login" today in the planner
    When I open today in the Day view
    And a minute passes
    Then today's "Ticket #101 - Login" entry shows "0:45"
    When another tool changes that entry in the planner to 60 minutes
    And a minute passes
    Then today's "Ticket #101 - Login" entry shows "1:00"
    When another tool deletes that entry in the planner
    And a minute passes
    Then the Day view shows no "Ticket #101 - Login" entry

  Scenario: An entry logged in another tool on a project the connection doesn't manage waits in Sync review
    Given the example planner manages "Acme - Support", with Time entries on
    And another tool logged 30 minutes on "Design review" of project "GLOBEX-INT" today in the planner
    When I open Sync review
    And a minute passes
    Then Sync review holds "Design review" on "GLOBEX-INT" for "0:30", because "The connection doesn't manage this project."
