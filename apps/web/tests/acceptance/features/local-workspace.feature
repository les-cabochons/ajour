Feature: Open the local time workspace
  Ajour users can begin daily time entry without signing in to a remote service.

  Scenario: Open today's workspace from a clean browser
    Given I have no saved Ajour workspace
    When I open today's time workspace
    Then the Time workspace is visible
    And the desktop sidebar owns the full left edge
    And the day surfaces stretch around centered content
    And the timesheet can be submitted

  Scenario: Collapse the desktop sidebar to an icon rail
    Given I have no saved Ajour workspace, even after a reload
    When I open today's time workspace
    Then the app sidebar is expanded
    When I collapse the app sidebar with its button
    Then the app sidebar is an icon rail
    When I reload the app
    Then the app sidebar is an icon rail
    When I press the sidebar shortcut
    Then the app sidebar is expanded
    When I narrow the app below the expanded sidebar width
    Then the app sidebar is an icon rail
    When I widen the app back to a desktop width
    Then the app sidebar is expanded

  Scenario: Use single-key shortcuts outside text fields
    Given I have no saved Ajour workspace
    When I open today's time workspace
    Then the Time workspace is visible
    When I press the "n" key
    Then the entry editor is open
    When I type "gb?" in the entry note
    Then the entry note reads "gb?"
    And the Time workspace is visible
    When I press the "Escape" key
    And I press the "g" key
    And I press the "b" key
    Then the Backlog workspace is open
    When I press the "?" key
    And I search the shortcut overlay for "sidebar"
    Then the shortcut overlay lists only "Show or hide the sidebar"

  Scenario: Submit part of a week from the submit page
    Given I have a week of saved entries
    When I open the submit page from the Week header
    Then the submit page merges Monday's task entries
    And copying the merged line gives decimal hours and merged comments
    When I drop Tuesday from the submission
    And I mark the selected entries as submitted under the target
    Then only Monday's entries are submitted
    And the submit page shows the week as partly submitted

  Scenario: Open the submit page from the narrow view
    Given I have a week of saved entries
    When I open the submit page from the narrow Day header
    Then the submit page lists the week's entries

  Scenario Outline: Undo deleting a time entry
    Given I have a week of saved entries
    When I delete Monday's "API" entry
    Then the entry is gone and a toast offers Undo
    When I undo with the <control>
    Then the "API" entry is back exactly as it was

    Examples:
      | control        |
      | toast button   |
      | Cmd+Z shortcut |

  Scenario: Open Settings inside the app shell
    Given I have no saved Ajour workspace
    When I open today's new-entry workspace
    And I open Settings from the desktop sidebar
    Then the Settings pages are listed beside the app sidebar
    When I open Plugins from the Settings navigation
    And I open Time from the app sidebar
    Then the Time workspace is visible

  Scenario: Open Settings directly
    Given I have no saved Ajour workspace
    When I open Settings directly
    Then the Settings pages are listed beside the app sidebar

  Scenario: Keep the desktop Projects sidebar expanded
    Given I have projects with searchable tasks
    When I open the Projects workspace
    Then the Projects sidebar remains expanded and left-aligned beside primary navigation
    And the Projects navigation remains available as a compact rail

  Scenario: Move around the narrow view from its titlebar
    Given I have projects with searchable tasks
    When I open today's time workspace in a narrow window
    Then the narrow view shows no sidebars
    When I switch to Backlog from the titlebar
    Then Backlog is the active section of the titlebar switcher
    When I open Settings from the titlebar cog
    Then Settings opens on its list of pages
    When I open "Plugins" from the Settings list
    And I go back to "Settings"
    And I open "Projects" from the Settings list
    Then the Projects list fills the page
    When I open project "aaa xyz" from the Projects list
    And I go back to "Projects"
    And I open project import and export from the Projects list
    Then the project import and export page leads back to Projects

  Scenario: Continue a second entry while the first one runs
    Given I have two saved entries with a timer running on the first
    When I continue the second entry
    Then the first timer is saved and the second timer is running

  Scenario: Start a fresh timer while another timer is running
    Given I have two saved entries with a timer running on the first
    When I start a fresh timer from the Time page
    Then the first timer is saved and the fresh timer is running

  Scenario: Start a Backlog timer while another timer is running
    Given I have two saved entries with a timer running on the first
    When I start the timer on the Backlog item
    Then the Backlog workspace fills the available page
    And expanded and dragged Backlog rows keep their centered columns
    And the first timer is saved and the Backlog timer is running

  Scenario: Start a Backlog timer from mobile while another timer is running
    Given I have two saved entries with a timer running on the first
    When I start the timer on the Backlog item from mobile
    Then the first timer is saved and the Backlog timer is running
    And hidden Backlog columns do not reserve mobile width

  Scenario: Find a time-entry task from project and task terms
    Given I have projects with searchable tasks
    When I open today's time workspace
    And I open the new time-entry project and task picker
    Then the picker initially lists projects without expanding their tasks
    When I browse the tasks in project "aaa xyz"
    Then the picker lists that project's tasks
    When I return to the project list
    And I search for project and task "aaa 222"
    And I select the matching project and task
    Then the combined project and task are selected
    When I save one hour to the selected project and task
    Then the time entry uses project "aaa xyz" and task "222 000"

  Scenario: Install a packaged connector from local files
    Given I have no saved Ajour workspace
    When I install a packaged connector from settings
    Then the connector plugin is reported as installed
    And I can open the connector plugin configuration

  Scenario: Deactivate a plugin without losing its configuration page
    Given I have no saved Ajour workspace
    When I install a packaged connector from settings
    And I deactivate the connector plugin with the keyboard
    Then the inactive connector plugin remains configurable

  Scenario: Explain an empty plugin catalog
    Given I have no saved Ajour workspace
    When I open the plugins catalog
    Then the empty plugin catalog is explained
    And Outlook Calendar is not offered

  Scenario: Uninstall a packaged connector while preserving imported work
    Given I have no saved Ajour workspace
    When I install a packaged connector from settings
    And I open the connector plugin configuration
    And I uninstall the connector plugin
    Then the connector plugin is reported as uninstalled

  Scenario: Configure a development plugin directory from Debug settings
    Given I have no saved Ajour workspace
    When I open development plugin settings
    Then I can choose a development plugin directory

  Scenario Outline: Preserve exact saved time when editing only a note
    Given I have a saved entry with an unrounded duration
    When I edit the entry note in the "<editor>" editor
    Then the edited note is saved with the exact original duration

    Examples:
      | editor |
      | Day    |
      | Week   |
      | mobile |
