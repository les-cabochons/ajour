Feature: Project time entries
  The project page's Time entries tab lists the newest entries first, about
  50 at a time, so a project with months of entries opens fast.

  Scenario: A long list shows whole days, 50 entries at a time
    Given I have the Atlas workspace
    And Atlas has 3 entries a day for 25 days
    When I open the Atlas project page
    And I open the Time entries tab
    Then the tab lists 51 entries over 17 days
    When I press Show more
    Then the tab lists 75 entries over 25 days
    And there is no Show more
