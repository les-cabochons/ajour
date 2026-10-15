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

  Scenario: Combine filters to see one project's to do items
    When I open the Backlog filters
    And I pick the "State" filter "To do"
    And I pick the "State" filter "No state"
    And I pick the "Project" filter "Example project"
    Then only the Backlog parent and its subitem appear on the Backlog page
    And the filter row has one chip per field

  Scenario: Show the project and remaining estimate on comfortable sidebar rows
    Given the other Backlog item has 1.5 hours remaining
    Then the other item's sidebar row shows "Example project" and "1h30"
    And the other item's sidebar row shows its workflow state "In progress"
    When I hover the other item in the sidebar
    Then its sidebar row offers Start entry, Snooze and Settle without a "…" button

  Scenario: Start and stop a focused sidebar item with S
    When I press S on the other item in the sidebar
    Then an entry runs on "other"
    When I press S on the other item in the sidebar
    Then no entry runs

  Scenario Outline: Switch to and stop a focused Backlog page item with S
    When I use the Backlog "<layout>" layout
    And I peek at the Backlog parent
    And I start an entry from the Backlog peek
    And I close the Backlog peek with Escape
    And I press S on the other item on the Backlog page
    Then an entry runs on "other"
    When I press S on the other item on the Backlog page
    Then no entry runs

    Examples:
      | layout |
      | List   |
      | Board  |

  Scenario: Open a subitem's parent from its comfortable sidebar row
    Then the subitem's sidebar row does not show its parent's title
    When I open the parent from the subitem's sidebar arrow
    Then the Backlog parent page is open

  Scenario: Pin a backlog item to the top of the sidebar
    When I "Pin" the other Backlog item from its sidebar menu
    Then the other item is pinned at the top of the sidebar
    When I start an empty entry from the sidebar
    Then the timer dock opens the running entry
    When I stop the Backlog running entry from the timer dock
    When I "Unpin" the other Backlog item from its sidebar menu
    Then the other item is not pinned

  Scenario: Peek and edit in the same side panel
    When I peek at the Backlog parent
    Then the peek shows the parent and its subitem
    When I edit the parent from the peek
    And I save the parent title as "Updated parent"
    Then the peek shows "Updated parent"
    When I close the Backlog peek with Escape
    Then the Backlog peek is closed

  Scenario Outline: Preserve the task when reselecting the peek project
    When I peek at the Backlog parent
    And I reselect the current peek project with "<control>"
    Then the peek retains the parent's project and task
    When I clear the peek project
    Then the peek has no project or task
    When I undo the last Backlog move
    Then the peek retains the parent's project and task
    When I reload the app
    And I peek at the Backlog parent
    Then the peek retains the parent's project and task

    Examples:
      | control |
      | click   |
      | Enter   |

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

  Scenario: Scroll an archived project swimlane with a touchscreen
    Given an archived project still has a Backlog item
    And the archived project has enough cards to scroll
    When I choose the Backlog board
    And I show Backlog projects as "swimlanes"
    Then the archived swimlane allows native touch handling
    When I swipe upward from an archived project card
    Then the board scrolls without starting a drag

  Scenario: Scroll a sorted ungrouped list and restore Custom dragging
    Given the Backlog has enough items to scroll
    When I use an ungrouped Backlog list ordered by Title
    Then the Backlog items allow native touch scrolling
    When I swipe upward from a sorted Backlog row
    Then the list scrolls without starting a drag
    When I order the Backlog by "Custom"
    Then the ungrouped custom list remains draggable
    When I reorder the ungrouped parent below the other item
    Then the ungrouped parent has moved below the other item
    When I undo the last Backlog move
    Then the ungrouped parent's original order is restored

  Scenario: Move sorted board cards between workflow states with touch
    When I choose the Backlog board
    And I order the Backlog by "Title"
    And I touch-drag the subitem to In progress
    Then the subitem is in In progress
    When I undo the last Backlog move
    Then the subitem is back in To do

  Scenario: Keep a running entry continuous when reopening its Backlog peek
    When I peek at the Backlog parent
    And I start an entry from the Backlog peek
    Then the parent peek cannot restart its running entry
    When I peek at the other Backlog item
    Then the other peek can start an entry
    When I peek at the Backlog parent
    Then the parent peek cannot restart its running entry
    When I stop the Backlog running entry from the timer dock
    Then the parent peek can start a new entry after Stop

  Scenario Outline: Stop the running item from its sidebar row
    When I use the "<density>" Backlog sidebar
    And I peek at the Backlog parent
    And I start an entry from the Backlog peek
    Then the parent's sidebar row offers Stop instead of Start entry
    When I stop the parent's entry from its sidebar row
    Then no entry runs
    And the sidebar Start icon enables the parent without a disabled reason

    Examples:
      | density     |
      | comfortable |
      | compact     |

  Scenario Outline: Offer Stop on the running item's row and card
    When I use the Backlog "<layout>" layout
    And I peek at the Backlog parent
    And I start an entry from the Backlog peek
    Then the parent row offers Stop for its running entry
    And the running entry has not restarted
    When I stop the Backlog running entry from the timer dock
    Then the parent Start icon is enabled without a disabled reason

    Examples:
      | layout |
      | List   |
      | Board  |

  Scenario Outline: Show running ownership in every Backlog action set
    When I peek at the Backlog parent
    And I start an entry from the Backlog peek
    Then Stop replaces Start entry for the running item in the "<control>"
    And the running entry has not restarted
    When I stop the Backlog running entry from the timer dock
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

  Scenario: Keep subitems outside the custom order
    When I use an ungrouped Backlog list ordered by Title
    And I order the Backlog by "Custom"
    And I record the Backlog custom order
    And I try to reorder the subitem with keys, requests and a pointer
    Then the Backlog custom order remains unchanged

  Scenario Outline: Move subitems between groups without changing custom order
    When I record the Backlog custom order
    And I choose the Backlog board
    And I group the Backlog by "<grouping>"
    And I drag the subitem to the "<destination>" group
    Then the subitem's "<grouping>" is "<value>"
    And the Backlog custom order remains unchanged
    When I undo the last Backlog move
    Then the subitem's "<grouping>" is "<original>"
    And the Backlog custom order remains unchanged

    Examples:
      | grouping | destination | value | original |
      | state    | In progress | doing | todo     |
      | priority | Medium      | 3     | 2        |
      | project  | No project  |       | p        |

  Scenario: Reorder root items around fixed subitem slots
    When I use an ungrouped Backlog list ordered by Title
    And I order the Backlog by "Custom"
    And I move the parent down with Alt and ArrowDown
    Then only the root items exchanged their custom order slots
    When I undo the last Backlog move
    Then the ungrouped parent's original order is restored

  Scenario: Restore a dragged card's custom order when its source write fails
    Given the Backlog root card has a source that rejects moves
    When I choose the Backlog board
    And I drag the source card below the other card in In progress
    Then the source card has moved below the other card
    And the failed source move restores the root card's workflow and custom order

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

  Scenario: Create an item in an ungrouped list
    When I group the Backlog by "none"
    And I add a Backlog item from the end of the list
    Then the new Backlog item is in the list

  Scenario: Show and collapse project swimlanes
    When I choose the Backlog board
    And I enable project swimlanes
    Then the Backlog has a collapsible Example project swimlane

  Scenario: Restore items from the Archived filter including missing sync items
    When I filter the Backlog by "State" "Archived"
    Then the Backlog shows the old done and missing sync items
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

  Scenario Outline: Save a draft before opening workflow settings
    Given the Backlog has an unmapped source state
    When I edit the other item from the Backlog peek
    And I rename the open editor draft to "Saved settings draft"
    And I follow the unmapped-state settings link with "<activation>"
    Then workflow settings opens with the other item's draft saved

    Examples:
      | activation |
      | click      |
      | Enter      |

  Scenario: Block workflow settings navigation for an invalid draft
    Given the Backlog has an unmapped source state
    When I edit the other item from the Backlog peek
    And I rename the open editor draft to ""
    And I follow the unmapped-state settings link with "click"
    Then Backlog keeps the invalid draft and its validation error

  Scenario Outline: Open workflow settings separately without committing the draft
    Given the Backlog has an unmapped source state
    When I edit the other item from the Backlog peek
    And I rename the open editor draft to "Separate settings draft"
    And I open the unmapped-state settings link with "<modifier>" held
    Then Backlog keeps its unsaved draft in the original page

    Examples:
      | modifier |
      | Control  |
      | Shift    |

  Scenario: Cancel a draft close before opening workflow settings
    Given the Backlog has an unmapped source state
    When I edit the parent item from the Backlog peek
    And I rename the open editor draft to "Pending settings draft"
    And I change the editor workflow draft to "Done"
    And I follow the unmapped-state settings link with "click"
    And I cancel the subitem close prompt
    Then the parent remains active and its editor stays open
    And Backlog keeps the pending settings draft

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

  Scenario: Edit a backlog item in place on its page
    When I open the Backlog parent page
    And I rename the item on its page to "Renamed parent"
    And I set its remaining estimate on its page to "5"
    And I write "**Bold** note" as its note on its page
    And I add the subitem "Inline subitem" on its page
    Then the Backlog parent keeps the inline edits
    And the item page has no actions menu and no editor panel

  Scenario: Escape cancels an inline edit on the item page
    When I open the Backlog parent page
    And I type in the title, the remaining estimate and the note and press Escape each time
    Then the Backlog parent keeps its saved title, estimate and note

  Scenario: Archive a synced item from the bottom of its properties card
    Given the Backlog parent is synced
    When I open the Backlog parent page
    And I archive it from its properties card
    Then the Backlog parent is archived and its page offers Restore
