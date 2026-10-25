Feature: Access review on the plugin page

  Background:
    Given I have no saved Ajour workspace

  Scenario: A catalog plugin says its access is listed after the download
    Given the catalog offers a plugin on plugin API 4 to download
    When I open the access catalog plugin page
    Then the Access section comes before Features
    And the Access section says the addresses are listed once it is downloaded
    And the Access section says the plugin stays inactive until it is turned on

  Scenario: An installed plugin lists what it reaches in plain words
    Given an installed Tracker plugin on plugin API 4
    When I open the Tracker plugin page
    Then the Access section comes before Features
    And the Access section lists these lines
      | line                                    |
      | The address in "Site URL"               |
      | People in your organisation             |
      | avatars.example.com                     |
      | The "API token" on each connection      |
      | Enter the week                          |
      | Loads when needed                       |
    And the Access section says "Ajour adds it to each request. The plugin never sees it."
    And the Access section says "Gets these Ajour tools: get_week_status."

  Scenario: The endpoints of a host sit behind a disclosure
    Given an installed Tracker plugin on plugin API 4
    When I open the Tracker plugin page
    Then the endpoints of the Site URL address are hidden
    When I open the endpoints of the Site URL address
    Then the endpoints of the Site URL address list
      | endpoint                      |
      | GET /rest/myself              |
      | PUT /rest/issue/* · Edit issues |

  Scenario: An installed plugin shows its last request and blocked attempts
    Given an installed Tracker plugin on plugin API 4 that made a request 3 minutes ago
    And its sandbox blocked it twice from connecting directly
    When I open the Tracker plugin page
    Then the Access section says "Last used 3 minutes ago."
    And the Access section warns "Tried to connect directly, blocked. 2 times"

  Scenario: Requests the broker refused are not attempts to connect directly
    Given an installed Tracker plugin on plugin API 4 that made a request 3 minutes ago
    And the broker refused 3 of its requests for access it doesn't have
    When I open the Tracker plugin page
    Then the Access section says the broker refused "Asked for access it doesn't have, refused. 3 times"
    And the Access section does not say "Tried to connect directly"

  Scenario: A plugin that has made no request says so and shows no warning
    Given an installed Tracker plugin on plugin API 4
    When I open the Tracker plugin page
    Then the Access section says "Not used yet."
    And the Access section shows no blocked attempts

  Scenario: A plugin on an older plugin API says Ajour cannot limit it
    Given an installed Tracker plugin on plugin API 3
    When I open the Tracker plugin page
    Then the Access section says "This plugin was built for an older plugin API, so Ajour can't limit it. Update it to move it onto one that does."
    And the Access section lists these lines
      | line                              |
      | Any address                       |
      | Each connection's saved settings  |
      | Enter the week                    |

  Scenario: An update that reaches more waits for the user to allow it
    Given a Tracker update 1.1.0 that reaches more and waits for consent
    When I open the Tracker plugin page
    Then the plugin page says "Version 1.1.0 needs more access"
    And the plugin is inactive
    And the update panel lists only these new lines
      | line                         |
      | People in your organisation  |
    And the Access section marks "People in your organisation" as New
    And the Access section does not mark "avatars.example.com" as New
    When I press "Allow and activate"
    Then the activation request turned the plugin on
    And the plugin page no longer says "needs more access"
    And the plugin is active

  Scenario: An update that only widens a host lists its new endpoints
    Given a Tracker update 1.1.0 that adds an endpoint and waits for consent
    When I open the Tracker plugin page
    Then the update panel lists only these new lines
      | line                       |
      | The address in "Site URL"  |
    And the update panel shows the new endpoint "GET /rest/people"

  Scenario: An update that reaches no more keeps the plugin active and shows no panel
    Given an active Tracker plugin and a Tracker 1.0.1 file that reaches no more
    When I install the Tracker file from the Plugins page
    Then Ajour says "Tracker 1.0.1 replaced the installed plugin."
    And Ajour does not say "needs more access"
    When I open the Tracker plugin page
    Then the plugin page does not say "needs more access"
    And the plugin is active
