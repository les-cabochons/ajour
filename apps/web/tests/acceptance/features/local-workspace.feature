Feature: Open the local time workspace
  Ajour users can begin daily time entry without signing in to a remote service.

  Scenario: Open today's workspace from a clean browser
    Given I have no saved Ajour workspace
    When I open today's time workspace
    Then the Time workspace is visible
    And the desktop sidebar owns the full left edge
    And the day surfaces stretch around centered content
    And the week can be committed

  Scenario: Hide the desktop sidebar and keep it beside the page in small windows
    Given I have no saved Ajour workspace, even after a reload
    When I open today's time workspace
    Then the app sidebar is expanded
    When I hide the app sidebar with its button
    Then the app sidebar is hidden
    When I reload the app
    Then the app sidebar is hidden
    When I press the sidebar shortcut
    Then the app sidebar is expanded
    When I narrow the app to the smallest desktop width
    Then the app sidebar is expanded beside the page
    When I hide the app sidebar with its button
    Then the app sidebar is hidden
    When I show the app sidebar from the titlebar
    Then the app sidebar is expanded beside the page

  Scenario: Follow the running entry with the sidebar hidden
    Given I have no saved Ajour workspace
    When I open today's time workspace
    And I start an empty entry from the sidebar
    Then the timer dock opens the running entry
    And the window title shows the running entry
    When I open Settings from the desktop sidebar
    Then the running entry floats at the bottom left
    When I go back to the app from Settings
    And I hide the app sidebar with its button
    Then the running entry floats at the bottom left
    When I stop the running entry from the floating dock
    Then nothing runs and the window title is plain
    When I start an empty entry from the floating dock
    Then the running entry floats at the bottom left
    And the floating dock opens the running entry

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

  Scenario: Copy a week's lines from the Commit page
    Given I have a week of saved entries
    When I open the Commit page from the Week totals dropdown
    Then the Commit page merges Monday's task entries
    And copying the merged line gives decimal hours and merged comments

  Scenario: Open the Commit page from the narrow view
    Given I have a week of saved entries
    When I open the Commit page from the narrow totals dropdown
    Then the Commit page lists the week's entries

  Scenario: Open the selected week's Commit page from Settings
    Given I have a week of saved entries
    When I open the Commit page from Settings totals
    Then the Commit page lists the week's entries

  Scenario: Save a valid entry draft before opening the Commit page
    Given I have a week of saved entries
    When I open the Commit page with "02:00" hours in an open entry
    Then the Commit page includes the saved entry draft

  Scenario: Keep an invalid entry draft open when opening the Commit page
    Given I have a week of saved entries
    When I open the Commit page with "invalid" hours in an open entry
    Then the invalid entry draft stays open instead of opening the Commit page

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

  Scenario: Edit and delete a Day entry with the keyboard only
    Given I have a week of saved entries
    When I focus the top entry of Monday's Day list
    And I press the "ArrowDown" key
    And I press the "Enter" key
    Then the side panel edits the "API" entry
    When I press the "Escape" key
    Then Monday's "API" entry has keyboard focus
    When I press the "Backspace" key
    Then the entry is gone and a toast offers Undo
    And Monday's "Code review" entry has keyboard focus
    When I press the "ControlOrMeta+z" key
    Then the "API" entry is back exactly as it was

  Scenario: Open a Week link in the narrow view
    Given I have a week of saved entries
    When I open a Week link in a narrow window
    Then the Day view notes that Week needs a wider window
    When I widen the window to a desktop width
    Then the Week view is visible

  Scenario: Long press an entry in the narrow view
    Given I have a week of saved entries
    When I long press Monday's "API" entry on a narrow touch screen
    Then the entry's action menu is open
    When I choose "Edit" from the action menu
    Then the entry editor opens in a full-width dialog

  Scenario: Reorder a day by dragging a card in the Week Days view
    Given I have a week of saved entries
    When I open the Week Days view
    Then Monday's cards read "Login form", "API", "Code review"
    When I drag Monday's "Code review" card above its "Login form" card
    Then Monday's cards read "Code review", "Login form", "API"

  Scenario: Move an entry to another day by dragging its card
    Given I have a week of saved entries
    When I open the Week Days view
    And I drag Monday's "API" card onto Wednesday
    Then Monday's cards read "Login form", "Code review"
    And Wednesday's cards read "API"

  Scenario: Add an entry by double-clicking a day's empty space
    Given I have a week of saved entries
    When I open the Week Days view
    Then Wednesday's column reaches the bottom of the page
    When I double-click the empty space at the bottom of Wednesday's column
    Then the side panel opens a new entry on "2026-10-07"

  Scenario: Add an entry at the end of a day by double-clicking its header
    Given I have a week of saved entries
    When I open the Week Days view
    And I double-click Monday's header
    And I save the new entry with note "Wrap-up" and hours "0:30"
    Then Monday's cards read "Login form", "API", "Code review", "Wrap-up"

  Scenario: Go back to the Day view after switching to Week
    Given I have a week of saved entries
    When I open Monday in the Day view
    And I switch the Time page to Week
    And I go back in the browser
    Then the Day view is visible

  Scenario: Double-clicking the capacity card does not add an entry
    Given I have a week of saved entries
    When I open the Week Days view
    And I double-click the text of Monday's capacity card
    Then no entry editor is open

  Scenario: The entry panel floats over a narrow Time page and docks on a wide one
    Given I have a week of saved entries
    When the window is 1280 pixels wide
    And I open the Week Days view
    Then opening Monday's "API" card floats the entry panel over the Week
    When the window is 1800 pixels wide
    Then the entry panel sits beside the Week and narrows it

  Scenario: Reopen Time in the view I used last
    Given I have a week of saved entries
    When I open the Week Days view
    And I open Backlog from the app sidebar
    And I open Time from the app sidebar
    Then the Week Days view is visible
    When I switch the Time page to Day
    And I open Backlog from the app sidebar
    And I open Time from the app sidebar
    Then the Day view is visible

  Scenario: Type hours in the Week Grid
    Given I have a week of saved entries
    When I open the Week Grid
    Then the "Development" cell on Monday shows "3:00 ×2"
    When I type "1:30" in the "Code review" cell on Tuesday and press Tab
    Then the "Code review" cell on Tuesday shows "1:30"
    And the "Code review" cell on Wednesday is being edited
    When I clear the "Code review" cell on Monday
    Then the "Code review" cell on Monday is empty and a toast offers Undo
    When I undo with the toast button
    Then the "Code review" cell on Monday shows "1:00"

  Scenario: Delete a Week Grid row that has time
    Given I have a week of saved entries
    When I open the Week Grid
    And I press Shift+Backspace on the "Code review" cell on Monday
    Then a dialog warns that deleting the "Code review" row deletes its entries
    When I confirm deleting the row
    Then the Week Grid has no "Code review" row
    When I undo with the toast button
    Then the "Code review" cell on Monday shows "1:00"

  Scenario: Delete an empty Week Grid row without confirmation
    Given I have a week of saved entries
    When I open the Week Grid
    And I add a Week Grid row without a task
    And I delete the "No task" row from its name menu
    Then the Week Grid has no "No task" row
    And no row deletion dialog is open
    And the "Development" cell on Monday has keyboard focus

  Scenario: Include an open draft when deleting a Week Grid row
    Given I have a week of saved entries
    When I open the Week Grid
    And I draft "2:00" hours in the "Code review" cell on Tuesday
    And I press Shift+Backspace on the "Code review" cell on Monday
    Then the row deletion dialog counts "2 entries (3:00)"
    When I confirm deleting the row
    Then the Week Grid has no "Code review" row
    When I undo with the toast button
    Then the "Code review" cell on Tuesday shows "2:00"

  Scenario: Include an open draft when deleting an initially empty Week Grid row
    Given I have a week of saved entries
    When I open the Week Grid
    And I add a Week Grid row without a task
    And I draft "0:30" hours in the "No task" cell on Tuesday
    And I press Shift+Backspace on the "No task" cell on Monday
    Then the row deletion dialog counts "1 entry (0:30)"
    When I confirm deleting the row
    Then the Week Grid has no "No task" row

  Scenario: Keep an invalid draft when deleting a Week Grid row
    Given I have a week of saved entries
    When I open the Week Grid
    And I draft "invalid" hours in the "Code review" cell on Tuesday
    And I press Shift+Backspace on the "Code review" cell on Monday
    Then no row deletion dialog is open
    And the Week Grid entry draft still has invalid hours
    And the "Code review" cell on Monday shows "1:00"

  Scenario: Open Settings in place of the app sidebar
    Given I have no saved Ajour workspace
    When I open today's new-entry workspace
    And I open Settings from the desktop sidebar
    Then the Settings pages replace the app sidebar
    When I open Plugins from the Settings navigation
    And I go back to the app from Settings
    Then the Time workspace is visible

  Scenario: Keep the running entry's draft across the narrow breakpoint
    Given I have no saved Ajour workspace
    When I open today's time workspace
    And I start an empty entry from the sidebar
    And I type "Standup notes" in the running entry's note
    And I narrow the window to the narrow view
    Then the running entry's dialog still has "Standup notes"
    When I widen the app back to a desktop width
    Then the running entry's popover still has "Standup notes"

  Scenario: Open one entry editor at a time
    Given I have no saved Ajour workspace
    When I open today's time workspace
    And I start an empty entry from the sidebar
    And I open a new entry from the timer dock "+"
    Then only the new entry's editor is open
    When I open the running entry from the timer dock
    Then only the running entry's editor is open

  Scenario: Return from Settings to the same view
    Given I have no saved Ajour workspace
    When I open today's time workspace in the Week view
    And I open Settings from the desktop sidebar
    And I go back to the app from Settings
    Then the Week view is back and the browser's Back skips Settings

  Scenario: Open Settings directly
    Given I have no saved Ajour workspace
    When I open Settings directly
    Then the Settings pages replace the app sidebar

  Scenario: Open the Projects list beside primary navigation
    Given I have projects with searchable tasks
    When I open the Projects workspace
    Then the Projects list opens beside primary navigation
    And the Projects list still opens beside the sidebar in a small window

  Scenario: Move around the narrow view from its navigation toggle
    Given I have projects with searchable tasks
    When I open today's time workspace in a narrow window
    Then the narrow view shows no sidebars
    And the titlebar holds the entry buttons and the navigation toggle floats at the bottom left
    When I switch to Backlog from the navigation toggle
    Then Backlog is the active section of the navigation toggle
    When I open Settings from the navigation toggle
    Then Settings opens on its list of pages
    And Settings is the active section of the navigation toggle
    When I open "Plugins" from the Settings list
    And I go back to "Settings"
    And I open "Projects" from the Settings list
    Then the Projects list fills the page
    When I open project "aaa xyz" from the Projects list
    And I go back to "Projects"
    And I open project import and export from the Projects list
    Then the project import and export page leads back to Projects

  Scenario: Follow the running entry from the narrow titlebar
    Given I have no saved Ajour workspace
    When I open today's time workspace in a narrow window
    And I press Start in the narrow titlebar
    Then the running entry's dialog is open
    When I type "Standup notes" in the running entry's note
    And I click outside the running entry's dialog
    Then no entry dialog is open
    And the totals pill shows the running time instead of Today
    When I open the current timer from the totals popover
    Then the running entry's dialog still has "Standup notes"
    When I close the running entry's dialog with Escape
    And I press Stop in the narrow titlebar
    Then the totals pill shows Today again

  Scenario: Start a task from the command palette
    Given I have projects with searchable tasks
    When I open the Backlog workspace
    And I open the command palette
    And I search the command palette for "333 bbb"
    And I choose "333 000" in the command palette
    And I choose "Start 333 000 (bbb zyx)" in the command palette
    Then a running entry uses project "project-bbb" and task "task-333"

  Scenario: Create a project from the command palette
    Given I have projects with searchable tasks
    When I open today's time workspace
    And I open the command palette
    And I choose "Create project" in the command palette
    And I create project "ccc new" in the project form
    Then project "ccc new" is open

  Scenario: Edit a task in the side panel with explicit Save
    Given I have projects with searchable tasks
    When I open project "aaa xyz"
    And I rename task "111 000" to "111 draft" and press Escape
    Then the project lists task "111 000"
    When I rename task "111 000" to "111 final" and save
    Then the project lists task "111 final"

  Scenario: Edit a project in place from its page
    Given I have projects with searchable tasks
    When I open project "aaa xyz"
    Then the project page has no actions menu
    When I rename the project to "aaa renamed" from its title
    And I set the project code to "ZZZ" in its properties
    Then project "aaa renamed" is open with code "ZZZ"
    When I add a task from the New task row
    Then the task editor opens for a new task
    When I archive the project from its properties
    Then the project properties offer Restore

  Scenario: Pin tasks to number keys
    Given I have projects with searchable tasks
    When I open project "aaa xyz"
    And I assign key "3" to task "111 000"
    And I assign key "3" to task "222 000"
    Then key "3" is saved on task "222 000" only
    When I press the "Digit3" key
    Then a new entry opens for "[AAA] aaa xyz · 222 000"
    When I press the "Escape" key
    Then the new entry form is closed
    When I press the "Shift+Digit3" key
    Then a running entry counts on task "222 000" of project "aaa xyz"
    When I clear the key of task "222 000"
    Then no task is pinned to key "3"

  Scenario: Assign shortcuts from the task panel and the command palette
    Given I have projects with searchable tasks
    When I open project "aaa xyz"
    And I set key "5" in the panel of task "111 000" and save
    Then only task "111 000" holds key "5"
    When I open the command palette
    And I search the command palette for "333 bbb"
    And I choose "333 000" in the command palette
    And I choose "Assign shortcut…" in the command palette
    And I pick key "5" in the shortcut picker
    Then only task "333 000" holds key "5"

  Scenario: Number keys do nothing in the entry editor
    Given I have projects with searchable tasks
    When I open project "aaa xyz"
    And I assign key "3" to task "111 000"
    And I open Time from the app sidebar
    Then the Time workspace is visible
    When I press the "n" key
    And I press "Digit3" on the entry editor's Cancel button
    Then the entry editor has no project or task

  Scenario: Continue a second entry while the first one runs
    Given I have two saved entries with a timer running on the first
    When I continue the second entry
    Then the first timer is saved and the second timer is running

  Scenario: A continued entry keeps its place while it runs
    Given I have two saved entries with a timer running on the first
    Then the Day list reads "First task", "Second task"
    And the running row shows Stop and no row has an actions button
    When I continue the second entry
    Then the Day list reads "First task", "Second task"
    When I open this week's Days view
    Then today's Days cards read entries "entry-first", "entry-second"

  Scenario: Undo deleting a backlog item and its subitem
    Given I have two saved entries with a timer running on the first
    When I delete the Backlog item with its subitem
    Then the Backlog item is gone and a toast offers Undo
    When I undo with the toast button
    Then the Backlog item and its subitem are back in place

  Scenario: Start a fresh timer while another timer is running
    Given I have two saved entries with a timer running on the first
    When I start a fresh timer from the Time page
    Then the first timer is saved and the fresh timer is running

  Scenario: Correct the running entry's hours from the timer dock
    Given I have two saved entries with a timer running on the first
    When I open the running entry from the timer dock on the Backlog page
    And I change its hours to "1:00" and save
    Then the running entry keeps running from one hour

  Scenario: Start a new entry that has no hours
    Given I have no saved Ajour workspace
    When I open a new entry from the titlebar on the Backlog page
    Then Save waits for hours or Start
    When I press Enter in Hours
    Then a running entry starts today with no time counted

  Scenario: Start a Backlog timer while another timer is running
    Given I have two saved entries with a timer running on the first
    When I start the timer on the Backlog item
    Then the Backlog workspace fills the available page
    And standalone subitems and cancellable Backlog drag remain usable
    And the first timer is saved and the Backlog timer is running

  Scenario: Start a Backlog timer from mobile while another timer is running
    Given I have two saved entries with a timer running on the first
    When I start the timer on the Backlog item from mobile
    Then the first timer is saved and the Backlog timer is running
    And the Backlog list fits a narrow window

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


  Scenario: Render Backlog preferences and settle rules once
    Given I have no saved Ajour workspace
    When I open the Backlog settings
    Then the Backlog settings contain one settle rules section

  Scenario: Keep an editor workflow draft after cancelling its close prompt
    Given I have a parent editor close fixture
    When I save its editor workflow as Done
    Then the parent editor remains mounted while the subitem choice is pending
    When I cancel the parent editor close prompt
    Then the parent editor retains its Done draft and the item remains active
    When I save its editor workflow as Done
    And I include the child in the editor close
    Then the editor closes after the parent and child reach Done

  Scenario Outline: Discard all draft fields after an interrupted parent close
    Given I have a parent editor close fixture
    When I change the parent draft title and note
    And I save its editor workflow as Done
    Then the parent editor remains mounted while the subitem choice is pending
    When I interrupt the mixed-field close by "<interruption>"
    Then the parent editor retains every mixed-field draft without saving it
    When I cancel the parent editor draft
    Then the parent title and note remain unchanged

    Examples:
      | interruption         |
      | dismissing the prompt |
      | adding a subitem      |

  Scenario: Save mixed draft fields after confirming a parent close
    Given I have a parent editor close fixture
    When I change the parent draft title and note
    And I save its editor workflow as Done
    And I include the child in the editor close
    Then the editor closes after the parent and child reach Done
    And the confirmed title and note remain saved after undoing the close

  Scenario: Close existing items when their workflow state becomes Done
    Given I have a parent editor close fixture
    And the parent has a running entry
    When I enable Done for In progress in Workflow settings
    Then its existing items are archived and the running entry is saved
