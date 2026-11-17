Feature: Ajour's version and manual application updates
  The sidebar header ends with Settings. While an update waits, the gear
  opens a menu with the update, What's new and Settings. The Settings
  window's left column ends with Ajour's version and the desktop update
  button. Updates only download after the user chooses to update.

  Scenario: Open Settings from the sidebar header
    Given I use the sidebar header in the browser
    Then the sidebar header ends with Settings alone
    When I open Settings from the header
    Then the General settings page is open
    And the browser has no application update button

  Scenario: Discover an update manually without starting installation
    Given the desktop has "idle" update state
    When I open Settings from the header
    And the desktop check returns "up-to-date"
    Then the Settings window shows Ajour 1.0.0 beside the update button
    When I click the update button
    Then the update button is disabled
    When the desktop check returns "available"
    Then the update button offers Ajour 1.0.1
    And the desktop has received no update request
    When I click the update button
    Then the desktop receives a request to confirm updating to 1.0.1
    And the update button is disabled
    When I cancel the desktop update warning
    Then the update button offers Ajour 1.0.1

  Scenario: Report a failed check and allow a retry
    Given the desktop has "idle" update state
    When I open Settings from the header
    And the desktop check returns "up-to-date"
    And I click the update button
    And the desktop check returns "error"
    Then the update button says the check failed
    When I click the update button
    And the desktop check returns "up-to-date"
    Then the update button says Ajour is up to date

  Scenario: Share availability and download progress with Settings
    Given the desktop has "available" update state
    When I open Settings from the header's update menu
    And the desktop check returns "available"
    Then the update button offers Ajour 1.0.1
    And Settings offers Update and restart
    When I choose Update and restart in Settings
    Then the desktop receives a request to confirm updating to 1.0.1
    When I accept the desktop update warning
    When the desktop reports download progress of 42 percent
    Then Settings shows the download progress
    And Settings disables Check again
    And Settings allows update track changes
    When the desktop starts installing the update
    Then Settings disables update track changes

  Scenario: Open the release page on a platform without in-place installation
    Given the desktop has "manual-install" update state
    When I open Settings from the header's update menu
    And the desktop check returns "available"
    And I click the update button
    Then the desktop opens the release page without an update request
