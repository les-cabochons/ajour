Feature: Browse plugin capabilities
  Background:
    Given I have no saved Ajour workspace
    And the catalog contains a plugin with backlog and code host capabilities

  Scenario Outline: Keep every catalog filter reachable
    When I open the catalog at <width> pixels wide
    Then every plugin filter fits inside the viewport

    Examples:
      | width |
      | 320   |
      | 390   |
      | 1280  |

  Scenario: List a plugin under every capability it provides
    When I open the plugins catalog
    And I select the "Backlog" plugin filter
    Then the combined plugin appears with its backlog and code host badge
    And the GitHub catalog entry offers a download
    When I select the "Code hosts" plugin filter
    Then the combined plugin appears with its backlog and code host badge
    And the GitHub catalog entry offers a download
    When I select the "Schemas" plugin filter
    Then the Workday schema is the only catalog entry
    When I select the "Agent tasks" plugin filter
    Then the Workday agent is the only catalog entry and offers a download

  Scenario: Say which catalog entries need a newer Ajour
    Given the catalog skipped an entry this Ajour cannot read
    When I open the plugins catalog
    Then the catalog says "Ajour can't show these plugins: future-plugin. Another source lists them first, or they need a newer Ajour."
    And the catalog does not say it was loaded from its local cache

  Scenario Outline: Update an incompatible installed plugin without removing its connections
    Given an installed Jira plugin uses an older plugin API
    When I open the <view> for Jira at <width> pixels wide
    Then Jira explains the plugin API mismatch
    When I update Jira
    Then Jira is available with its saved connection

    Examples:
      | view    | width |
      | catalog | 390   |
      | details | 1280  |

  Scenario: Keep an incompatible plugin and its connections after a download failure
    Given an installed Jira plugin uses an older plugin API
    And the next Jira update download fails
    When I open the details for Jira at 1280 pixels wide
    And I update Jira
    Then the update error is shown and Jira can be updated again
    When I update Jira
    Then Jira is available with its saved connection

  Scenario: Update a local-only incompatible plugin from a file
    Given an installed Jira plugin uses an older plugin API
    And Jira has no catalog download
    When I open the details for Jira at 390 pixels wide
    Then Jira offers an update from file instead of a catalog update
    When I update Jira from a file
    Then Jira is available with its saved connection

  Scenario: Review a plugin source before adding it
    Given Alice's unsigned plugin source can be added
    When I open the plugins catalog
    And I add the plugin source "https://codeberg.org/alice/plugins"
    Then Ajour shows the source's plugins and warns that it isn't signed
    When I confirm adding the source
    Then Alice's plugins is listed as an unsigned source

  Scenario: Install from a file only once unsigned installs are allowed
    Given plugins can be installed from a file
    When I open the plugins catalog
    Then installing from a file waits for unsigned installs to be allowed
    When I allow installing unsigned plugins
    Then I can install a plugin from a file
