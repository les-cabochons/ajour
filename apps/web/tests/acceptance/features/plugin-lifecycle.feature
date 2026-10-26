Feature: How a sandboxed plugin starts, and one that keeps stopping
  Background:
    Given I have no saved Ajour workspace
    And the catalog contains a plugin with backlog and code host capabilities
    And an installed Jira plugin runs in a sandbox of its own

  Scenario Outline: Choose how Jira starts and how much memory it may use
    When I open Jira's plugin page at <width> pixels wide
    Then the page ends with an Advanced section showing Start "Plugin's choice (Load when needed)" and the plugin's memory ceiling of 256 MB
    When I choose "Always ready" for Start
    Then Ajour saves Start "alwaysReady" with the plugin's memory ceiling
    When I enter "32" as the memory ceiling
    Then the memory ceiling says "Enter a whole number of MB from 64 to 2048." and nothing more is saved
    When I enter "512" as the memory ceiling
    Then Ajour saves Start "alwaysReady" with a memory ceiling of 512 MB

    Examples:
      | width |
      | 390   |
      | 1280  |

  Scenario Outline: Turn back on a plugin that keeps stopping
    Given Jira kept stopping, the last time above its memory ceiling
    When I open Jira's plugin page at <width> pixels wide
    Then Jira's page says "This plugin keeps stopping" with "It stopped 3 times in 10 minutes. The last time, it used more memory than its ceiling allows. Ajour keeps it off until you turn it back on or restart Ajour."
    When I turn Jira back on
    Then Jira's page no longer says "This plugin keeps stopping"

    Examples:
      | width |
      | 390   |
      | 1280  |
