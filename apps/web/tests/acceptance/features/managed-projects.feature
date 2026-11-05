Feature: Managed projects from a project source

  Scenario: The example project source links a local project by its code, which keeps its name, and Sync now picks up a rename
    Given I have a local project "Support (mine)" with the code "ACME-SUP"
    And the example project source is connected
    When I sync the example project source now
    Then Settings says "Planner · 1 linked · 1 added · 1 archived"
    And the project I had is now "Acme - Support", from the source project "ACME-SUP"
    When the source renames "ACME-SUP" to "Acme - Support 2027"
    And I sync the example project source now
    Then the project I had is now "Acme - Support 2027", from the source project "ACME-SUP"
    When I open the Projects workspace
    Then the Projects list shows "Support (mine)"
    And the Projects list doesn't show "Globex - Internal"
