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
    Then the guide tree folds to its ticks
    When I switch to Files A–Z
    Then the changed files show in path order

  Scenario: Read a pull request's summary and go to a line's hunk
    Given the local API built the requested pull request's guide
    When I open Deck
    And I open the requested pull request summary
    Then the summary names the linked ticket, the kinds and each section's lines
    When I follow the summary's line about the test
    Then the test's hunk is in view and focused

  Scenario: Read the agent's guide and go back to the one built from the code
    Given the local API shows the guide an agent regrouped
    When I open Deck
    And I open the requested pull request summary
    Then the guide says it was grouped by Claude Code
    And the summary shows the agent's inferred problem and breaking change
    When I open Regroup…
    Then its instruction is ready to send as is
    When I go back to the guide built from the code
    Then the guide says it was built from the code

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

  Scenario: Reply to a thread, resolve it, suggest a change and mark a file viewed
    Given the local API built the requested pull request's guide
    And the code host has a thread on line 13 and takes replies, resolves and viewed files
    When I open Deck
    And I open the requested pull request summary
    And I reply "Capped at 30 s in the next push." to the thread
    Then the reply "Capped at 30 s in the next push." shows in the thread
    When I resolve the thread
    Then the thread reads Resolved, with Unresolve
    When I suggest a change on the line that reads "  const delay = backoff(attempt);"
    Then the comment holds a suggestion block of "  const delay = backoff(attempt);"
    When I press the "Escape" key
    And I switch to Files A–Z
    And I mark the file "src/client/retry.ts" viewed
    Then the code host marks "src/client/retry.ts" viewed at the head read

  Scenario: Explain selected lines and turn the answer into a comment
    Given the local API built the requested pull request's guide
    And the code host takes reviews
    And asks about lines are answered with "It waits longer each time, as `src/client/retry.ts:13` shows."
    When I open Deck
    And I open the requested pull request summary
    And I drag over the line numbers from line 12 to line 14
    Then the toolbar for "Lines 12–14 selected" shows above line 12
    When I press the "e" key
    Then the explanation of "lines 12–14" follows the hunk with "It waits longer each time"
    When I follow the citation "src/client/retry.ts:13"
    Then line 13 is highlighted on screen
    When I turn the explanation into a comment
    Then the composer holds "It waits longer each time, as `src/client/retry.ts:13` shows."
    When I add it to the review with Ctrl+Enter
    Then a draft comment on lines 12 to 14 holds "It waits longer each time"

  Scenario: Open the chat beside the review and continue an explanation in it
    Given the local API built the requested pull request's guide
    And asks about lines are answered with "It waits longer each time."
    And the chat answers with Claude Code
    When I open Deck
    And I open the requested pull request summary
    And I press the "a" key
    Then the chat opens above the dock
    And the chat's header reads "#1 · Claude Code · PR"
    When I pin the chat
    Then the chat is docked on the right, 360px wide, beside the review
    When I close the chat
    And I drag over the line numbers from line 12 to line 14
    And I press the "e" key
    Then the explanation of "lines 12–14" shows "It waits longer each time."
    When I continue the explanation in the chat
    Then the chat's composer carries the chip "src/client/retry.ts, lines 12–14"
    When I send "Why that backoff?" in the chat
    Then the chat sends "Why that backoff?" about lines 12 to 14

  Scenario: Open the chat as a full-height sheet on a narrow screen
    Given the local API built the requested pull request's guide
    And the chat answers with Claude Code
    When I open Deck on a narrow screen
    And I open the requested pull request summary
    And I open the chat
    Then the chat covers the narrow viewport

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

  Scenario: Explain selected lines on a narrow screen
    Given the local API built the requested pull request's guide
    And asks about lines are answered with "It waits longer each time."
    When I open Deck on a narrow screen
    And I open the requested pull request summary
    And I drag over the line numbers from line 12 to line 14
    Then the toolbar for "Lines 12–14 selected" shows above line 12
    When I press the "e" key
    Then the explanation of "lines 12–14" shows "It waits longer each time."
    And the explanation fits the narrow viewport after the hunk

  Scenario: Keep an explanation while its rows of a pull request with many hunks scroll away
    Given the local API built the guide of a pull request with 600 hunks
    And asks about lines are answered with "Each step reads its own line."
    When I open Deck
    And I open the requested pull request summary
    And I drag over the line numbers of "src/f000.ts" from line 1 to line 3
    And I press the "e" key
    Then the explanation of "lines 1–3" shows "Each step reads its own line."
    When I move the focus out of the changes
    And I scroll the changes down by 20000 pixels
    Then no explanation is mounted
    When I scroll the changes back to the top
    Then the explanation of "lines 1–3" shows "Each step reads its own line."

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

  Scenario: Move through a stack from its strip and the full stack
    Given the requested pull request is the middle layer of a stack
    And the local API built the requested pull request's guide
    When I open Deck
    Then the stack's layers show together, each with its place
    When I open the requested pull request summary
    Then the stack strip reads "Stack 2 of 3 · main ← #3 ← #1 this ← #4"
    And the strip warns that #3 changed since this layer was based on it
    And Status says it merges after #3
    When I press the "l" key
    Then the full stack lists its layers in merge order
    When I open #4 from the full stack
    Then the review page of "Rate limits per user" shows

  Scenario: Fold the stack strip on a narrow screen
    Given the requested pull request is the middle layer of a stack
    And the local API built the requested pull request's guide
    When I open Deck on a narrow screen
    And I open the requested pull request summary
    Then the stack strip folds to Stack 2/3 and the page fits the viewport
    When I unfold the stack strip
    Then the full stack lists its layers in merge order
