Feature: Description frontmatter

  Background:
    Given a backlog item's description has frontmatter
    When I open that backlog item's page

  Scenario: The block shows in the properties, not in the description
    Then the description shows only "Build the hero section from the mockup."
    And the property "Teamwork" links to "https://acme.teamwork.com/app/tasks/123"
    And the frontmatter section "Links" is closed
    When I toggle the frontmatter section "Links"
    Then the frontmatter section "Links" lists "https://figma.com/file/hero"
    When I reload the page
    Then the frontmatter section "Links" is open

  Scenario: A description link asks before it opens
    When I click the description link "the mockup"
    Then Ajour asks to open "https://figma.com/file/hero"
    When I answer the link question with "Cancel"
    Then no link opened
    When I click the description link "the mockup"
    And I answer the link question with "Open link"
    Then "https://figma.com/file/hero" opened in a new tab

  Scenario: A middle click and the keyboard ask too
    When I middle-click the property link "Teamwork"
    Then Ajour asks to open "https://acme.teamwork.com/app/tasks/123"
    When I answer the link question with "Cancel"
    And I press Enter on the description link "the mockup"
    Then Ajour asks to open "https://figma.com/file/hero"
    And no link opened

  Scenario: Don't ask again, then turn the question back on
    When I click the description link "the mockup"
    And I check "Don't ask again" and answer the link question with "Open link"
    Then "https://figma.com/file/hero" opened in a new tab
    When I click the property link "Teamwork"
    Then "https://acme.teamwork.com/app/tasks/123" opened in a new tab without a question
    When I turn on "Ask before opening description links" in Settings › Backlog
    And I open that backlog item's page
    And I click the description link "the mockup"
    Then Ajour asks to open "https://figma.com/file/hero"

  Scenario: Create the project the timelog names
    Then the backlog item has no project
    When I create the timelog's project from the warning after Project
    Then the backlog item's project is "Beta Corp" and its task "Integration"
    And a toast reads "Project created"
