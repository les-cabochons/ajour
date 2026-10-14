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
