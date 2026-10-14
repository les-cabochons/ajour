Feature: Agents through MCP
  Scenario: Add an MCP client and see its token once
    Given MCP is on with no clients
    When I open Settings MCP
    And I add the MCP client "Claude Code on this Mac"
    Then I see its token and the command for Claude Code
    When I reload the page
    Then the client "Claude Code on this Mac" is listed without its token

  Scenario: An agent starts an entry
    Given MCP is on and "Claude Code" starts an entry on "Acme" "Build"
    When I open the app
    Then an entry is running on "Acme" "Build"
    And a toast reads "Claude Code: Started an entry"
    And the bridge received a successful result

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
