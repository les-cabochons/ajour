Feature: Agents through MCP
  Scenario: Add an agent client and see its token once
    Given MCP is on with no clients
    When I open Settings MCP
    And I add the agent client "Claude Code on this Mac"
    Then I see its token and the command for Claude Code
    When I reload the page
    Then the client "Claude Code on this Mac" is listed without its token

  Scenario: An agent starts an entry
    Given MCP is on and "Claude Code" starts an entry on "Acme" "Build"
    When I open the app
    Then an entry is running on "Acme" "Build"
    And a toast reads "Claude Code: Started an entry"
    And the bridge received a successful result

  Scenario: An agent's comment goes out when its Undo toast closes
    Given MCP is on and "Claude Code" comments "Fixed in 1.2" on a synced item whose connection allows "readWrite"
    When I open the app
    Then a toast reads "Claude Code: Commented on a backlog item"
    And the bridge received the queued comment
    When the agent's Undo toast closes on its own
    Then the source received the comment "Fixed in 1.2"

  Scenario: An agent can't read comments the user didn't allow
    Given MCP is on and "Claude Code" reads the comments of a synced item whose connection allows "none"
    When I open the app
    Then the bridge received a refusal naming the "Work" connection

  Scenario: The indicator stays hidden while MCP is off
    Given MCP is off
    When I open the app
    Then the agent indicator is absent

  Scenario: An agent asks a question and I answer it
    Given MCP is on and "Claude Code" asks "Which project gets the 2 hours?" with choices "Acme" and "Globex"
    When I open the app
    Then the agent indicator reads "Needs input"
    And a toast reads "Claude Code asks: Which project gets the 2 hours?"
    When I open the agent panel and choose "Acme"
    Then the answer "Acme" is sent for that question
    And the question toast is gone

  Scenario: I read a session's chat beside the page and answer its question
    Given MCP is on and "Claude Code" runs "Fill Workday" asking "Which project gets the 2 hours?" and "Check Jira" saying "Found 3 tickets"
    When I open the app
    And I open the agent panel
    Then the session "Fill Workday" lists "Claude Code", "active" and "1 h 30 min left"
    And the chat shows "Reading the week"
    When I select the session "Check Jira"
    Then the chat shows "Found 3 tickets"
    And the page stays usable beside the panel
    When I select the session "Fill Workday"
    And I choose "Globex" in the chat
    Then the answer "Globex" is sent for that question

  Scenario: I dismiss a stalled session
    Given MCP is on and "Claude Code" has a stalled session "Fill Workday"
    When I open the app
    And I open the agent panel
    And I dismiss the session
    Then the dismissal is sent for the session "Fill Workday"
    And the session "Fill Workday" can no longer be dismissed

  Scenario: The panel opens as an overlay in a narrow window
    Given MCP is on and "Claude Code" asks "Which project gets the 2 hours?" with choices "Acme" and "Globex"
    When I open the app on a narrow screen
    Then the agent indicator sits on the navigation toggle's row
    When I open the agent panel
    Then the agent panel is an overlay

  Scenario: The narrow view keeps the page inside the window under the back bar
    Given MCP is on with no clients
    When I open Settings MCP on a narrow screen
    Then the page content ends within the window
