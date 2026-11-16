Feature: Sidebar grouped by project
  Settings > General can group the sidebar's backlog items by project. Each
  project is a section headed by its name and what its items have left,
  ordered by its first item in the list, with the items without a project
  last. A drag reorders within a project, never across projects. One list
  stays the default.

  Background:
    Given I have backlog items across projects and none
    When I open the Backlog workspace

  Scenario: Group the sidebar by project from Settings
    Then the sidebar shows no project sections
    When I group the sidebar by project in Settings
    Then the sidebar sections read "Harbor", "Atlas", "No project"
    And the section "Atlas" totals "3h30"
    And the section "Atlas" lists "Atlas export", "Atlas grid"
    And the section "Harbor" lists "Harbor pinned", "Harbor sync"
    And the section "No project" lists "Loose note"

  Scenario: Keep a collapsed project collapsed after a reload
    When I group the sidebar by project in Settings
    And I collapse the section "Atlas"
    Then the section "Atlas" lists nothing
    When I reload the app
    Then the section "Atlas" lists nothing
    And the section "Harbor" lists "Harbor pinned", "Harbor sync"

  Scenario: Reorder within a project, never across projects
    When I group the sidebar by project in Settings
    And I drag the sidebar row "Atlas grid" above "Atlas export"
    Then the section "Atlas" lists "Atlas grid", "Atlas export"
    When I drag the sidebar row "Loose note" above "Atlas grid"
    Then the section "Atlas" lists "Atlas grid", "Atlas export"
    And the section "No project" lists "Loose note"
