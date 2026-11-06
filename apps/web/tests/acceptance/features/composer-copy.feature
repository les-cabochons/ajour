Feature: Copy text out of the editors

  Scenario: Copy a synced item's ticket line from its editor
    Given I have a synced backlog item "Fix export rounding" from Azure DevOps ticket 48213
    And the page may read the clipboard
    When I edit "Fix export rounding" from the Backlog
    And I select its ticket line in the editor and copy it
    Then the clipboard holds "#48213 · Contoso · Atlas · Bug"
    And the editor's ticket line still offers Open in source

  Scenario: Copy in the entry editor copies no entry
    Given I have a week of saved entries
    And the page may read the clipboard
    When I open Monday in the Day view
    And I double-click Monday's first entry
    And another app copies "kept"
    And I press Copy with focus on the entry editor's project chip
    Then the clipboard holds "kept"
