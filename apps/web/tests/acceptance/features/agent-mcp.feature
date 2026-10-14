Feature: Agents through MCP
  Scenario: Add an MCP client and see its token once
    Given MCP is on with no clients
    When I open Settings MCP
    And I add the MCP client "Claude Code on this Mac"
    Then I see its token and the command for Claude Code
    When I reload the page
    Then the client "Claude Code on this Mac" is listed without its token
