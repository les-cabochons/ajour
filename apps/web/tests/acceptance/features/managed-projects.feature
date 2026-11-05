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

  Scenario: A managed project's card names its source and locks what the source sets
    Given I have a local project "Support (mine)" with the code "ACME-SUP"
    And the example project source is connected
    When I sync the example project source now
    And I open project "Support (mine)"
    Then the title says "From Example planner"
    And the Full name, Code and Client rows are locked by "Example planner"
    And the link "Open in Example planner" opens "https://planner.example/projects/ACME-SUP"
    When I open the Projects workspace
    Then the Projects list marks "Support (mine)" as from "Example planner"

  Scenario: The task menu says which of a managed project's tasks are not assigned to me
    Given I have a local project "Support (mine)" with the code "ACME-SUP"
    And the example project source is connected
    When I sync the example project source now
    And I open today's time workspace
    And I open the new time-entry project and task picker
    And I open "[ACME-SUP] Support (mine)" in the task menu
    Then the task menu's "Tasks" section lists "Ticket #101 - Login, Ticket #102 - Export"
    And only "Ticket #102 - Export" says "Not assigned" in the task menu
