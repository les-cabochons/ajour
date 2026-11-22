Feature: On-premises connections

  Scenario: A connection to an http address saves once marked on-premises
    Given a plugin whose connections may be marked on-premises
    When I add a connection to "http://127.0.0.1:4096" marked on-premises
    Then the connection was saved on-premises with the address "http://127.0.0.1:4096"
    When I edit the saved connection
    Then "On-premises" is still on
