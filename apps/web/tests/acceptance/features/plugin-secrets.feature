Feature: Saved secrets show their state

  Background:
    Given I have no saved Ajour workspace

  Scenario Outline: A saved secret shows its state in place of a mask
    Given an Azure DevOps connection whose token is <state>
    When I edit the Azure DevOps connection
    Then the token shows the <kind> chip saying "<text>"
    And the token field shows no value

    Examples:
      | state              | kind       | text                           |
      | saved              | saved      | Saved                          |
      | expiring in 5 days | expiring   | Expires in 5 days              |
      | expired            | expired    | Expired on                     |
      | rejected           | rejected   | Token rejected                 |
      | unreadable         | unreadable | Can't be read on this computer |
      | not set            | not_set    | Not set                        |

  Scenario: A secret address is never shown as text
    Given a calendar connection with a saved secret address
    When I edit the calendar connection
    Then the secret address shows as saved and is not an input
    When I replace the secret address
    Then the replacement is an empty password input

  Scenario: Replace opens an empty password input that Cancel closes
    Given an Azure DevOps connection whose token is saved
    When I edit the Azure DevOps connection
    And I press Replace on the token
    Then the token has an empty password input and a Cancel button
    When I press Cancel on the token
    Then the token shows the saved chip saying "Saved"
    And focus is on Replace for the token

  Scenario: Replace sends the new token and nothing else about the old one
    Given an Azure DevOps connection whose token is saved
    When I edit the Azure DevOps connection
    And I press Replace on the token
    And I paste the new token "pat-new-1234"
    And I update the connection
    Then the connection was saved with the new token "pat-new-1234"

  Scenario: Saving other settings keeps the saved token
    Given an Azure DevOps connection whose token is saved
    When I edit the Azure DevOps connection
    And I rename the connection to "Contoso EU"
    And I update the connection
    Then the connection was saved without a token

  Scenario: Remove deletes the token and pauses the connection
    Given an Azure DevOps connection whose token is saved
    When I edit the Azure DevOps connection
    And I press Remove on the token and confirm
    Then the API was asked to remove the "token" secret
    And the token shows the not_set chip saying "Not set"
    And focus is on the token input
    And the connection row says "Paused" and "Its token was removed. Edit the connection to add one and resume sync."

  Scenario: Set a reminder date on a token
    Given an Azure DevOps connection whose token is saved
    When I edit the Azure DevOps connection
    And I set the token's expiry date to "2031-03-14"
    Then the token's expiry field says it is a reminder only
    When I update the connection
    Then the connection was saved with the reminder date "2031-03-14"

  Scenario Outline: A token that expires soon, or has, warns on the connection row
    Given an Azure DevOps connection whose token is <state>
    When I open the Azure DevOps plugin page
    Then the connection row warns "<text>" for the token
    And the connection row says "Connected" and "Personal access token"

    Examples:
      | state              | text              |
      | expiring in 5 days | Expires in 5 days |
      | expired            | Expired on        |

  Scenario: A rejected token shows on the connection row and leads to Replace
    Given an Azure DevOps connection whose token is rejected
    When I open the Azure DevOps plugin page
    Then the connection row says "Token rejected" and "Azure DevOps refused the token. Sync is paused. Edit the connection to replace it."
    And the connection row has no Error chip
    When I edit the Azure DevOps connection
    Then the token has an empty password input and a Cancel button

  Scenario Outline: The Vault lists every secret by plugin
    Given a Vault with secrets of several plugins
    When I open the Vault at <width> pixels wide
    Then the Vault groups are "Azure DevOps", "Calendar (ICS)", "Workday (agent)", "Jira (not installed)" in that order
    And the Vault shows "Contoso" with "Personal access token", "Last used 2 hours ago" and "Expires in 5 days"
    And the Vault shows "Fabrikam" with "Token rejected"
    And the Vault shows "Work calendar" with "Calendar address" and "Saved"
    And the Vault shows "Agent tasks" with "API key" and "Can't be read on this computer"
    And nothing in the Vault overflows the viewport

    Examples:
      | width |
      | 390   |
      | 1280  |

  Scenario: Replace in the Vault opens the connection's form with Replace open
    Given a Vault with secrets of several plugins
    When I open the Vault at 1280 pixels wide
    And I press Replace for Contoso in the Vault
    Then the Azure DevOps plugin page opens the token's replacement input

  Scenario: Remove a plugin that is not installed from the Vault
    Given a Vault with secrets of several plugins
    When I open the Vault at 1280 pixels wide
    And I remove "Jira (not installed)" from the Vault and confirm
    Then the Vault no longer lists "Jira (not installed)"
    And focus is on the Vault heading
    And the API was asked to remove the data of "jira"

  Scenario: Say when Ajour can't protect credentials, and try again
    Given a Vault whose encryption is unavailable because "No keyring (basic_text)."
    When I open the Vault at 1280 pixels wide
    Then the Vault says "Ajour can't protect credentials on this computer" with "No keyring (basic_text)."
    When the computer can encrypt again and I press Try again
    Then the Vault has no notice

  Scenario: Say when saved secrets can't be read on this computer
    Given a Vault whose saved secrets can't be read
    When I open the Vault at 1280 pixels wide
    Then the Vault says "Saved secrets can't be read on this computer" with "Paste each token again to resume sync."
    And the Vault offers no Try again

  Scenario: Agent task settings marked secret get the same field
    Given the Workday agent has a saved secret API key
    When I open the Workday agent plugin page
    Then the API key shows the saved chip saying "Saved"
    When I press Remove on the "API key" and confirm
    Then the API was asked to remove the agent task "apiKey" secret

  Scenario: A saved agent task secret returns to its saved state after Save
    Given the Workday agent has a saved secret API key
    When I open the Workday agent plugin page
    And I replace the API key with "key-new-1234"
    And I save the task settings
    Then the API key is back to its saved state
