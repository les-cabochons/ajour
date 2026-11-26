Feature: Deck lists the pull requests on your plate
  Background:
    Given a code host connection with local pull requests

  Scenario: Group pull requests and keep the sidebar separate from backlog items
    When I open Deck
    Then review requests appear under Active and authored changes under Settled
    And the pull request sidebar contains only active review requests
    When I settle the requested pull request with its row key
    Then the requested pull request leaves the sidebar and stays Settled after reload

  Scenario: Snooze a pull request and return it on a new mention when enabled
    When I enable Changes end a snooze early
    And I open Deck
    And I snooze the requested pull request
    Then the requested pull request is absent from the sidebar
    When a sync reports a new mention on the requested pull request
    Then the requested pull request returns with its Returned mark
    When I open the requested pull request summary
    Then the Returned mark is acknowledged

  Scenario: Plugin deactivation hides navigation and preserves local choices
    When I open Deck
    And I deactivate the code host plugin
    And I go back to the app from Settings
    Then Deck navigation disappears and local records remain
    When I reactivate the code host plugin
    And I go back to the app from Settings
    Then Deck navigation returns with the same local records

  Scenario: Turning pull requests off keeps the plugin's backlog items on
    Given the code host plugin also syncs backlog items
    When I open Deck
    And I turn off pull requests for the code host plugin
    Then the plugin and its backlog items stay active
    When I go back to the app from Settings
    Then Deck navigation disappears and local records remain
    When I turn on pull requests for the code host plugin
    And I go back to the app from Settings
    Then Deck navigation returns with the same local records

  Scenario: Connection removal asks before deleting its pull requests
    When I open the GitHub connection settings
    And I ask to remove the GitHub connection
    Then the removal confirmation states the saved pull request count
    When I confirm removal of the GitHub connection
    Then the connection's pull request records are deleted

  Scenario: Open a pull request source with Ctrl-click
    When I open Deck
    And I Ctrl-click the requested pull request
    Then its source opens and the list stays open

  Scenario: Reach Deck from the narrow bottom switcher
    When I open Deck on a narrow screen
    Then Deck fits the viewport
    And Deck is in the narrow bottom switcher and not in the Settings list

  Scenario: Sync a code host connection automatically
    Given the code host connection has automatic sync enabled
    When I open Deck
    Then a code host sync runs automatically

  Scenario: New mentions respect the default snooze setting
    When I open Deck
    And I snooze the requested pull request
    And a sync reports a new mention on the requested pull request
    Then the requested pull request is absent from the sidebar
    And the requested pull request remains snoozed

  Scenario: A merged pull request leaves the sidebar immediately
    When I open Deck
    And a sync reports the requested pull request merged
    Then the requested pull request is absent from the sidebar
    And the sidebar has no Pull requests section
    And the requested pull request appears under Recently closed

  Scenario: List pull requests and backlog items in one sidebar
    When I open Deck
    Then the sidebar shows backlog controls and pull requests together
    And the pull request sidebar contains only active review requests
    When I collapse the sidebar Pull requests section
    Then Deck stays open
    And the sidebar pull requests are collapsed

  Scenario: Fit the sidebar at its minimum width and drop pull requests for inactive code hosts
    When I open Deck
    And I set the sidebar to its minimum width
    Then the sidebar section labels fit inside the sidebar
    When I deactivate the code host plugin
    And I go back to the app from Settings
    Then the sidebar has no Pull requests section and backlog controls are visible

  Scenario: Read a pull request in its guide's order
    Given the local API built the requested pull request's guide
    When I open Deck
    And I open the requested pull request summary
    Then its changes show the guide's concerns in reading order
    When I press the "j" key
    And I press the "j" key
    Then the second concern is focused
    When I mark the second concern's first hunk viewed
    Then the guide tree shows the second concern half viewed
    When I press the "f" key
    Then the guide tree lists the concerns' titles
    When I switch to Files A–Z
    Then the changed files show in path order

  Scenario: Read a pull request's summary and go to a line's hunk
    Given the local API built the requested pull request's guide
    When I open Deck
    And I open the requested pull request summary
    Then the summary names the linked ticket, the kinds and each section's lines
    When I follow the summary's line about the test
    Then the test's hunk is in view and focused

  Scenario: Draft a review beside the lines and finish it
    Given the local API built the requested pull request's guide
    And the code host takes reviews
    When I open Deck
    And I open the requested pull request summary
    And I comment "Cap the backoff." on the line that reads "  const delay = backoff(attempt);"
    And I add it to the review with Ctrl+Enter
    Then the draft comment "Cap the backoff." sits beside its line
    When I press the "r" key
    And I press the "a" key
    Then Finish review opens on Approve
    When I submit the review
    Then the code host gets an approval with the comment "Cap the backoff."

  Scenario: Comment on a line from the keyboard
    Given the local API built the requested pull request's guide
    And the code host takes reviews
    When I open Deck
    And I open the requested pull request summary
    And I comment "Cap the backoff." on line 13 from the keyboard
    And I add it to the review with Ctrl+Enter
    Then the draft comment "Cap the backoff." sits beside its line

  Scenario: Read a pull request too large for a guide
    Given the local API answers a pull request with too many hunks for a guide
    When I open Deck
    And I open the requested pull request summary
    Then its files show A–Z with the reason there is no guide
    And only the rows near the screen are mounted
    When I press the "j" key
    And I press the "j" key
    Then file 2 is focused at the top of the changes
    When I press the "k" key
    Then file 1 is focused at the top of the changes
    When I scroll the guide tree to its end
    And I go to the last file from its tick
    Then file 240 is focused at the top of the changes
    When I mark the last file's first hunk viewed
    Then the last file's tick counts it viewed

  Scenario: Follow a summary line on a pull request with many hunks
    Given the local API built the guide of a pull request with 600 hunks
    When I open Deck
    And I open the requested pull request summary
    Then only the rows near the screen are mounted
    When I follow the summary's line about the leftover
    Then the leftover's hunk is focused at the top of the changes

  Scenario: Move through the guide of a pull request with many hunks
    Given the local API built the guide of a pull request with 600 hunks
    When I open Deck
    And I open the requested pull request summary
    Then only the rows near the screen are mounted
    When I press the "j" key
    And I press the "j" key
    Then concern 2 is focused at the top of the changes
    When I scroll the changes down by 3000 pixels
    And I press the "k" key
    Then concern 2 is focused at the top of the changes
    When I press the "k" key
    Then concern 1 is focused at the top of the changes
    When I scroll the changes down by 20000 pixels
    Then concern 1's title keeps the focus off screen

  Scenario: Read a pull request too large for a guide on a narrow screen
    Given the local API answers a pull request with too many hunks for a guide
    When I open Deck on a narrow screen
    And I open the requested pull request summary
    Then its files show A–Z with the reason there is no guide
    And the guide tree's ticks run in one row within the narrow viewport

  Scenario: Read a pull request's guide on a narrow screen
    Given the local API built the requested pull request's guide
    When I open Deck on a narrow screen
    And I open the requested pull request summary
    Then the guide fits the narrow viewport
