Feature: Sidebar footer actions and manual application updates
  Settings and Commit stay on the left. Desktop updates stay on the right
  and only download after the user chooses to update.

  Scenario: Open the selected week's Commit page with the keyboard
    Given I use the sidebar footer in the browser
    When I open the footer's Commit button with the keyboard
    Then the footer opens Commit for 2026-10-05
    And the browser has no application update button
    When I open Settings from the footer
    Then the General settings page is open
    And the browser has no application update button

  Scenario: Discover an update manually without starting installation
    Given the desktop footer has "idle" update state
    When I click the footer update button
    Then the footer update button is disabled
    When the desktop check returns "available"
    Then the footer offers Ajour 1.0.1
    And the desktop has received no update request
    And the footer actions stay at opposite ends
    When I click the footer update button
    Then the desktop receives a request to confirm updating to 1.0.1
    And the footer update button is disabled
    When I cancel the desktop update warning
    Then the footer offers Ajour 1.0.1

  Scenario: Report a failed check and allow a retry
    Given the desktop footer has "idle" update state
    When I click the footer update button
    And the desktop check returns "error"
    Then the footer update button says the check failed
    When I click the footer update button
    And the desktop check returns "up-to-date"
    Then the footer says Ajour is up to date

  Scenario: Share availability and download progress with Settings
    Given the desktop footer has "available" update state
    Then the footer offers Ajour 1.0.1
    When I open Settings from the footer
    And the desktop check returns "available"
    Then Settings offers Update and restart
    When I choose Update and restart in Settings
    Then the desktop receives a request to confirm updating to 1.0.1
    When I accept the desktop update warning
    When the desktop reports download progress of 42 percent
    Then Settings shows the download progress
    And Settings disables Check again

  Scenario: Open the release page on a platform without in-place installation
    Given the desktop footer has "manual-install" update state
    When I click the footer update button
    Then the desktop opens the release page without an update request
