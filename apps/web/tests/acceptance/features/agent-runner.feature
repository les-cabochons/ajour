Feature: Agent tasks from plugins

  Scenario: Settings lists the installed agents
    Given the local API reports Claude Code installed and Codex missing
    When I open Settings > Agents
    Then the agent choice offers "Claude Code 2.1.0"
    And the agent choice shows "Codex (not installed)" as unavailable

  Scenario: I start Enter in Workday from the Commit page
    Given the local API reports a ready "Enter in Workday" task with a week link
    When I open the Commit page for the week of 2026-10-12
    Then I see a link "Open the week in Workday" to "https://wd.example/t?date=2026-10-12"
    When I press "Enter in Workday"
    Then the run is requested for the week of 2026-10-12
    And the agent panel shows "Enter in Workday, week of 2026-10-12" with Stop

  Scenario: The button says what is missing
    Given the local API reports the "Enter in Workday" task blocked by "Fill in Workday timesheet URL in Settings > Plugins > Workday"
    When I open the Commit page for the week of 2026-10-12
    Then "Enter in Workday" is disabled with the reason "Fill in Workday timesheet URL in Settings > Plugins > Workday"

  Scenario: I fill in the settings a plugin's tasks share, once
    Given the Workday plugin is installed without its timesheet URL
    When I open the Workday plugin settings
    Then both tasks say "Fill in Workday timesheet URL in Settings > Plugins > Workday"
    And the page asks for "Workday timesheet URL" once
    When I fill in "Workday timesheet URL" with "https://wd.example/t"
    And I press "Save"
    Then the timesheet URL "https://wd.example/t" is saved
    And both tasks say "Ready to run from the Commit page."

  Scenario: A plugin's submit task keeps manual submission available
    Given the local API reports a ready "Check Workday and submit" submit task
    When I open the Commit page for the week of 2026-10-12
    Then the Commit page offers "Check Workday and submit" alongside Submit week
    And "Check Workday and submit" is the primary button
    When I press "Check Workday and submit"
    Then the "submit-week" run is requested for the week of 2026-10-12

  Scenario: Submit week stays available while the agent tasks load
    Given the local API holds back a ready "Check Workday and submit" submit task
    When I open the Commit page for the week of 2026-10-12
    Then the manual Submit week button is enabled
    When the local API sends the agent tasks
    Then the Commit page offers "Check Workday and submit" alongside Submit week

  Scenario: Manually submit and reopen a committed week without starting an agent
    Given I have a committed week of entries
    And the local API reports a ready "Check Workday and submit" submit task
    When I change Monday's "API" entry to "2:30" hours
    And I open the Commit page for the week of 2026-10-05
    Then "Submit week" is disabled with the reason "Commit your changes first"
    When I press "Mark as committed"
    And I press "Submit week"
    And I press "Submit anyway"
    Then the Commit page shows the week is submitted
    And no agent run is requested
    When I undo the manual week submission
    Then the Commit page shows the week is not submitted
    When I press "Submit week"
    And I press "Submit anyway"
    And I reload the page
    Then the Commit page shows the week is submitted
    When I press "Reopen week"
    Then the Commit page shows the week is not submitted
    And no agent run is requested
