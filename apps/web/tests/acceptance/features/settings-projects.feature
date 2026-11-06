Feature: Settings, projects and destructive actions
  Removing, archiving and editing ask or explain before data changes in ways
  the user did not see coming, and fields accept what people type.

  Scenario: Removing a workflow state that items use asks where they go
    Given I have the Atlas workspace
    When I remove the workflow state "In progress" in Workflow settings
    Then a dialog says "2 items are in In progress."
    When I move them to "In review" and remove the state
    Then the toast says "In progress removed. 2 items moved to In review."
    And both items are in "In review"
    When I remove the workflow state "To do" in Workflow settings
    Then no dialog asks and the toast says "Workflow state deleted"

  Scenario: Archiving a project stops and saves its running entry
    Given I have the Atlas workspace
    And an entry runs on Atlas
    When I open the Atlas project page
    And I archive the project from its properties card
    Then the toast says "Project archived. Its running entry stopped and was saved."
    And no entry runs and the Atlas entry is saved
    And the sidebar no longer lists "Atlas login bug"
    When I press Undo in the toast
    Then the Atlas entry runs again

  Scenario: Number fields in Settings let me clear them while typing
    Given I have the Atlas workspace
    When I open Calendar settings
    And I select all in the number field "Refresh every" and type "5"
    Then the number field "Refresh every" shows "5"
    And the refresh setting is saved as 5 when I leave the field
    When I clear the number field "Hide events shorter than" with Backspace
    Then the number field "Hide events shorter than" shows ""
    When I type "30" in the number field "Hide events shorter than"
    Then the number field "Hide events shorter than" shows "30"
    When I leave the number field
    And I clear the number field "Hide events shorter than" with Backspace
    And I leave the number field
    Then the number field says "Enter a whole number of minutes from 0 to 480."
    And the shortest event setting is still 30

  Scenario: Project codes are tidied and checked, and names can't be emptied
    Given I have the Atlas workspace
    When I open the Atlas project page
    And I set the code to "atl" in its properties
    Then the code reads "ATL"
    When I set the code to "ab c-123 toolongcode!!" in its properties
    Then the property says "A code has up to 10 letters, digits, - or _."
    And the saved code is still "ATL"
    When I set the full name to "" in its properties
    Then the property says "Enter a full name."
    And the saved full name is still "Atlas Platform"

  Scenario: Duplicate project and task names warn
    Given I have the Atlas workspace
    When I start a new project named "beta"
    Then the composer warns "Another project is named Beta."
    When I close the composer
    And I open the Atlas project page
    And I start a new task named "design"
    Then the composer warns "Atlas already has a task named Design."

  Scenario: The color field takes short and bare hex, and says why it refuses
    Given I have the Atlas workspace
    When I open the Atlas project page
    And I type "#fff" in the project color field and press Enter
    Then the project color is "#ffffff"
    When I type "ff8800" in the project color field and press Enter
    Then the project color is "#ff8800"
    When I type "#1234567" in the project color field and press Enter
    Then the color field says "Enter a hex color, such as #4f46e5 or #fff."
    And the project color is "#ff8800"

  Scenario: A long title without spaces stays inside its column
    Given I have the Atlas workspace with long titles
    When I open the long backlog item
    Then its title and buttons stay inside the page
    When I open the long project
    Then its title stays inside the page

  Scenario: The Tasks tab counts active tasks
    Given I have the Atlas workspace
    When I open the Atlas project page
    Then the Tasks tab counts 2

  Scenario: Create more keeps the task composer open for the next task
    Given I have the Atlas workspace
    When I open the Atlas project page
    And I start a new task named "Review"
    And I create the task
    Then the New task button has the focus
    When I start a new task named "One"
    And I turn on Create more
    And I create the task
    Then the task name field is empty and has the focus
    When I type "Two" in the task name field and press Enter
    Then Atlas Platform has the tasks "Review", "One" and "Two"

  Scenario: A workbook import names the row of its error and keeps it in view
    Given I have the Atlas workspace
    When I open Projects settings
    And I import a workbook whose row 3 has budget hours "abc"
    Then the import error names row 3 and its budget hours "abc"
    And the import error is in view

  Scenario: A workbook import says what it changed and skipped
    Given I have the Atlas workspace
    When I open Projects settings
    And I import a workbook that renames Atlas, has a negative budget, a color "red" and a duplicate task row
    Then the import summary says "Renamed Atlas Platform to atlas platform."
    And the import summary says "Skipped the negative budget of atlas platform · Build."
    And the import summary says it skipped the color "red" of atlas platform
    And the import summary says "Merged 1 repeated task row: atlas platform · Design."
