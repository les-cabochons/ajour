Feature: Pull requests on your plate
  Background:
    Given a code host connection with local pull requests

  Scenario: Group pull requests and keep the sidebar separate from backlog items
    When I open the pull request list
    Then review requests appear under Active and authored changes under Settled
    And the pull request sidebar contains only active review requests
    When I settle the requested pull request with its row key
    Then the requested pull request leaves the sidebar and stays Settled after reload

  Scenario: Snooze a pull request and return it on a new mention when enabled
    When I enable Changes end a snooze early
    And I open the pull request list
    And I snooze the requested pull request
    Then the requested pull request is absent from the sidebar
    When a sync reports a new mention on the requested pull request
    Then the requested pull request returns with its Returned mark
    When I open the requested pull request summary
    Then the Returned mark is acknowledged

  Scenario: Plugin deactivation hides navigation and preserves local choices
    When I open the pull request list
    And I deactivate the code host plugin
    And I go back to the app from Settings
    Then pull request navigation disappears and local records remain
    When I reactivate the code host plugin
    And I go back to the app from Settings
    Then pull request navigation returns with the same local records

  Scenario: Turning pull requests off keeps the plugin's backlog items on
    Given the code host plugin also syncs backlog items
    When I open the pull request list
    And I turn off pull requests for the code host plugin
    Then the plugin and its backlog items stay active
    When I go back to the app from Settings
    Then pull request navigation disappears and local records remain
    When I turn on pull requests for the code host plugin
    And I go back to the app from Settings
    Then pull request navigation returns with the same local records

  Scenario: Connection removal asks before deleting its pull requests
    When I open the GitHub connection settings
    And I ask to remove the GitHub connection
    Then the removal confirmation states the saved pull request count
    When I confirm removal of the GitHub connection
    Then the connection's pull request records are deleted

  Scenario: Open a pull request source with Ctrl-click
    When I open the pull request list
    And I Ctrl-click the requested pull request
    Then its source opens and the list stays open

  Scenario: Reach pull requests from the narrow navigation
    When I open the pull request list on a narrow screen
    Then the pull request list fits the viewport
    And Pull requests is available from the narrow Settings list

  Scenario: Sync a code host connection automatically
    Given the code host connection has automatic sync enabled
    When I open the pull request list
    Then a code host sync runs automatically

  Scenario: New mentions respect the default snooze setting
    When I open the pull request list
    And I snooze the requested pull request
    And a sync reports a new mention on the requested pull request
    Then the requested pull request is absent from the sidebar
    And the requested pull request remains snoozed

  Scenario: A merged pull request leaves the sidebar immediately
    When I open the pull request list
    And a sync reports the requested pull request merged
    Then the requested pull request is absent from the sidebar
    And the sidebar has no Pull requests section
    And the requested pull request appears under Recently closed

  Scenario: List pull requests and backlog items in one sidebar
    When I open the pull request list
    Then the sidebar shows backlog controls and pull requests together
    And the pull request sidebar contains only active review requests
    When I collapse the sidebar Pull requests section
    Then the pull request page stays open
    And the sidebar pull requests are collapsed

  Scenario: Fit the sidebar at its minimum width and drop pull requests for inactive code hosts
    When I open the pull request list
    And I set the sidebar to its minimum width
    Then the sidebar section labels fit inside the sidebar
    When I deactivate the code host plugin
    And I go back to the app from Settings
    Then the sidebar has no Pull requests section and backlog controls are visible
