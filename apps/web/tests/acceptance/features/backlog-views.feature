Feature: Backlog list and board views
  Backlog display options change the page while item actions keep the same lifecycle rules.

  Background:
    Given I have a backlog view fixture
    When I open the Backlog workspace

  Scenario: Keep the board preference while using a narrow list
    When I choose the Backlog board
    Then the Backlog has workflow columns and standalone subitems
    When I narrow the Backlog window
    Then the saved board uses a narrow list
    And the Backlog items allow native touch scrolling
    When I widen the Backlog window
    Then the Backlog has workflow columns and standalone subitems
    When I reload the app
    Then the Backlog has workflow columns and standalone subitems

  Scenario: Filter the page without filtering the sidebar
    When I filter the Backlog to Urgent
    Then only urgent items appear on the Backlog page
    And the sidebar still contains the other Backlog items
    When I remove the Urgent filter
    Then all open Backlog items return

  Scenario: Peek and edit in the same side panel
    When I peek at the Backlog parent
    Then the peek shows the parent and its subitem
    When I edit the parent from the peek
    And I save the parent title as "Updated parent"
    Then the peek shows "Updated parent"
    When I close the Backlog peek with Escape
    Then the Backlog peek is closed

  Scenario Outline: Clear Returned when an item is opened in the peek
    Given the Backlog parent has returned through "<reason>"
    When I use the Backlog "<layout>" layout
    Then the parent has a Returned mark in the sidebar
    When I open the parent peek with "<control>"
    Then the peek clears the parent's Returned mark
    When I reload the app
    Then the parent's Returned mark remains cleared

    Examples:
      | layout | reason         | control |
      | List   | sync           | click   |
      | List   | expired snooze | Space   |
      | Board  | expired snooze | click   |
      | Board  | sync           | Space   |

  Scenario Outline: Keep archived project assignments without allowing new destinations
    Given an archived project still has a Backlog item
    When I choose the Backlog board
    And I show Backlog projects as "<presentation>"
    Then the archived project shows its item without creation controls
    When I try to drag the other card into the archived project
    Then the other card's assignment and custom order have not changed
    When I create a Backlog item in the active project group
    Then the new editor uses the active project

    Examples:
      | presentation |
      | groups       |
      | swimlanes    |

  Scenario: Keep a running entry continuous when reopening its Backlog peek
    When I peek at the Backlog parent
    And I start an entry from the Backlog peek
    Then the parent peek cannot restart its running entry
    When I peek at the other Backlog item
    Then the other peek can start an entry
    When I peek at the Backlog parent
    Then the parent peek cannot restart its running entry
    When I stop the Backlog running entry from the titlebar
    Then the parent peek can start a new entry after Stop

  Scenario: Explain the disabled Start icon in the compact sidebar
    When I use the compact Backlog sidebar
    And I peek at the Backlog parent
    And I start an entry from the Backlog peek
    Then the sidebar Start icon explains that the parent is already running
    And the running entry has not restarted
    When I stop the Backlog running entry from the titlebar
    Then the sidebar Start icon enables the parent without a disabled reason

  Scenario Outline: Explain the running item's Start icon in rows and cards
    When I use the Backlog "<layout>" layout
    And I peek at the Backlog parent
    And I start an entry from the Backlog peek
    Then the parent Start icon explains that it is already running
    And the running entry has not restarted
    When I stop the Backlog running entry from the titlebar
    Then the parent Start icon is enabled without a disabled reason

    Examples:
      | layout |
      | List   |
      | Board  |

  Scenario Outline: Show running ownership in every Backlog action set
    When I peek at the Backlog parent
    And I start an entry from the Backlog peek
    Then Start entry is disabled for the running item in the "<control>"
    And the running entry has not restarted
    When I stop the Backlog running entry from the titlebar
    Then Start entry is enabled after Stop in the "<control>"

    Examples:
      | control         |
      | item page       |
      | editor          |
      | sidebar         |
      | command palette |

  Scenario: Drag a subitem to another state and undo it
    When I choose the Backlog board
    And I drag the subitem to In progress
    Then the subitem is in In progress
    When I undo the last Backlog move
    Then the subitem is back in To do

  Scenario: Drag a board card with a touchscreen and undo it
    When I choose the Backlog board
    And I touch-drag the subitem to In progress
    Then the subitem is in In progress
    When I undo the last Backlog move
    Then the subitem is back in To do

  Scenario: Restore a dragged card's custom order when its source write fails
    Given the Backlog subitem has a source that rejects moves
    When I choose the Backlog board
    And I drag the subitem below the other card in In progress
    Then the subitem has moved below the other card
    And the failed source move restores the subitem's workflow and custom order

  Scenario: Close a parent and its subitems from the board
    When I choose the Backlog board
    And I move the parent to Done and include its subitems
    Then the parent and its subitem are archived in Done
    When I undo the last Backlog move
    Then the parent and its subitem are active again

  Scenario: Create an item in its selected group
    When I choose the Backlog board
    And I add a Backlog item in In progress
    Then the new Backlog item is in In progress

  Scenario: Show and collapse project swimlanes
    When I choose the Backlog board
    And I enable project swimlanes
    Then the Backlog has a collapsible Example project swimlane

  Scenario: Restore items from Archive including missing sync items
    When I open the Backlog Archive
    Then Archive contains the old done and missing sync items
    And the Backlog items allow native touch scrolling
    When I restore the old done item
    Then the old done item is active in To do

  Scenario: Use the priority key when the property is hidden
    When I hide the Backlog priority property
    And I set the parent priority to Low with its key
    Then the parent priority is Low

  Scenario Outline: Close the editor after archiving its item
    Given the other Backlog item uses "<source>"
    When I edit the other item from the Backlog peek
    And I choose "<action>" in the Backlog editor actions
    Then the Backlog editor is closed and the other item is archived

    Examples:
      | source | action  |
      | azure  | Archive |
      | manual | Settle  |

  Scenario: Undo an editor move between non-done workflow states
    When I edit the other item from the Backlog peek
    And I save the other item in To do
    Then the other item is in To do and Undo is offered
    When I undo the last Backlog move
    Then the other item is back in In progress

  Scenario Outline: Finish a workflow draft before an editor action
    Given the other Backlog item uses "<source>"
    When I edit the other item from the Backlog peek
    And I change the editor workflow draft to "To do"
    And I choose "<action>" in the Backlog editor actions
    Then the Backlog editor is closed and the other item is archived

    Examples:
      | source | action  |
      | azure  | Archive |
      | manual | Settle  |

  Scenario: Cancel a draft move before running an editor action
    When I edit the parent item from the Backlog peek
    And I change the editor workflow draft to "Done"
    And I choose "Settle" in the Backlog editor actions
    And I cancel the subitem close prompt
    Then the parent remains active and its editor stays open

  Scenario: Keep board arrow navigation in its project swimlane
    Given an earlier project has asymmetric board columns
    When I choose the Backlog board
    And I enable project swimlanes
    And I move focus right from the parent card
    Then the other card has focus
    When I press ArrowDown on the other card
    Then the other card has focus
    When I press ArrowLeft on the other card
    Then the parent card has focus

  Scenario: Keep a board drop after committing its open editor
    When I choose the Backlog board
    And I edit the subitem from its peek
    And I rename the open editor draft to "Saved subitem draft"
    And I drag the subitem to In progress
    Then the subitem is in In progress
    And the Backlog editor is closed
    When I edit the subitem from its peek
    And I save the open Backlog editor
    Then the subitem is in In progress
    And the saved subitem title is "Saved subitem draft"

  Scenario Outline: Commit the open editor before an Alt-arrow move
    When I edit the other item from the Backlog peek
    And I rename the open editor draft to "Saved arrow draft"
    And I press "<key>" on the other Backlog row
    Then the Backlog editor is closed
    And the other item retains its draft in "<state>" with status "<status>"

    Examples:
      | key       | state | status   |
      | Alt+ArrowLeft  | todo  | active   |
      | Alt+ArrowRight | done  | archived |
