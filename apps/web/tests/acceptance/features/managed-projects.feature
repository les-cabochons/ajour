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
    And at 390px the title is whole and the "From Example planner" mark is cut first
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

  Scenario: Merge into… moves a local task's entries to a source task, under its name
    Given I have a local project "Support (mine)" with the code "ACME-SUP"
    And its task "Login fixes" has an entry "Fixed the redirect"
    And the example project source is connected
    When I sync the example project source now
    And I open the project "Support (mine)"
    And I merge the task "Login fixes" into "Ticket #101 - Login"
    Then the toast says "1 entry moved to Ticket #101 - Login"
    And the project's entries show "Fixed the redirect" under "Ticket #101 - Login"
    And the task "Login fixes" is archived

  Scenario: Ajour suggests merging a local task with a close name, until I say it is not the same
    Given I have a local project "Support (mine)" with the code "ACME-SUP"
    And its task "Ticket 101 - Login" has an entry "Fixed the redirect"
    And the example project source is connected
    When I sync the example project source now
    And I open the project "Support (mine)"
    Then a merge suggestion says "Looks like “Ticket #101 - Login” from Example planner."
    When I answer "Not the same" on the suggestion
    Then no merge suggestion shows
    When I reload the page
    Then no merge suggestion shows

  Scenario: The budget card counts what the source can't have yet, and finds an hour it lacks after a commit
    Given I have a local project "Support (mine)" with the code "ACME-SUP"
    And I logged 2 hours on its task "Ticket #101 - Login" on 2026-11-02
    And the example project source is connected
    When I sync the example project source now
    And I open project "Support (mine)"
    Then the budget card reads "2:00" Not counted yet and "6:30" Remaining
    When I open the Commit page for the week of 2026-11-02
    And I press "Mark as committed"
    And the source counts the commit, but only 1 hour of it for me
    And I sync the example project source now
    And I open project "Support (mine)"
    Then the budget card reads "0:00" Not counted yet and "6:30" Remaining
    And the budget card says "Example planner has 1h for you. You committed 2h before"
    When I press "See the 1h"
    Then the committed entries show "Ticket #101 - Login" with "You 2:00"
