Feature: Connection access and held edits

  Scenario: An Azure DevOps connection reads only until editing is turned on
    Given an Azure DevOps connection that reads only and holds no changes
    When I open the Azure DevOps plugin page with its access
    Then the connection row has the badge "Reads backlog"
    When I edit the connection with its access
    Then the Access group lists each choice with the token scope it needs
    And "Read the backlog" is on and can't be turned off
    When I turn on "Edit work items" and update the connection
    Then the connection was saved with editing work items on

  Scenario: Held changes are counted on the connection row and in the Access group
    Given an Azure DevOps connection that reads only and holds a settle and a comment
    When I open the Azure DevOps plugin page with its access
    Then the connection row says "2 changes held. Turn on editing to review and send them."
    When I edit the connection with its access
    Then the Access group says 2 changes made while editing was off are held
    And nothing was sent to Azure DevOps

  Scenario: Turning editing on opens Sync review, where each held change is sent or discarded
    Given an Azure DevOps connection that reads only and holds a settle and a comment
    When I open the Azure DevOps plugin page with its access
    And I edit the connection with its access
    And I turn on "Edit work items" and update the connection
    Then Sync review shows 2 held changes for "Contoso"
    And nothing was sent to Azure DevOps
    When I send the held "Settle or move"
    Then the settle went to Azure DevOps
    When I discard the held "Comment" and confirm
    Then Sync review shows no held changes
    And no comment was posted to Azure DevOps
