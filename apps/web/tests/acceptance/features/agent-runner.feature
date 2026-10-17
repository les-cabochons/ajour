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

  Scenario: I fill in the task settings on the plugin's page
    Given the Workday plugin is installed without its timesheet URL
    When I open the Workday plugin settings
    Then the task says "Fill in Workday timesheet URL in Settings > Plugins > Workday"
    When I fill in "Workday timesheet URL" with "https://wd.example/t"
    And I press "Save"
    Then the timesheet URL "https://wd.example/t" is saved
    And the task says "Ready to run from the Commit page."

  Scenario: A plugin's submit task replaces Submit week
    Given the local API reports a ready "Check Workday and submit" submit task
    When I open the Commit page for the week of 2026-10-12
    Then the Commit page offers "Check Workday and submit" instead of Submit week
    When I press "Check Workday and submit"
    Then the "submit-week" run is requested for the week of 2026-10-12
