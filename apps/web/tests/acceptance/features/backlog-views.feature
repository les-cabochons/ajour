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
    And the narrow Backlog adds items from its group headers only
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
    And I write "**Bold** description" as its description on its page
    And I add the subitem "Inline subitem" on its page
    Then the Backlog parent keeps the inline edits
    And the item page has no actions menu and no editor panel

  Scenario: Save a description with the keyboard on the item page
    When I open the Backlog parent page
    And I write "Saved from the keys" as its description and press Mod+Enter
    Then the Backlog parent's description is "Saved from the keys"
    And its description shows "Saved from the keys"

  Scenario: Escape cancels an inline edit on the item page
    When I open the Backlog parent page
    And I type in the title, the remaining estimate and the description and press Escape each time
    Then the Backlog parent keeps its saved title, estimate and description

  Scenario: Read a synced item's comments on its page
    Given the Backlog parent is synced
    And its plugin lists seven comments, two new from others since my last visit
    When I open the Backlog parent page
    Then the page shows the newest five comments with a New divider before Ana's reply
    And my comment says You and its mention shows as a chip
    When I show earlier comments
    Then all seven comments show, oldest first

  Scenario: Switching items from the sidebar replaces the synced item's page
    Given the Backlog parent is synced
    And its plugin lists seven comments, two new from others since my last visit
    When I open the Backlog parent page
    And I open "Other backlog item" from the sidebar
    And I open "Backlog parent" from the sidebar
    And I open "Other backlog item" from the sidebar
    Then the item page shows one description, for "Other backlog item"

  Scenario: Post a comment on a synced item
    Given the Backlog parent is synced
    And its plugin lists seven comments, two new from others since my last visit
    And its plugin accepts new comments
    When I open the Backlog parent page
    And I write "Shipping it today" in a new comment and press Mod+Enter
    Then my new comment "Shipping it today" shows last in the thread

  Scenario: A comment that fails to send stays as a draft
    Given the Backlog parent is synced
    And its plugin lists seven comments, two new from others since my last visit
    And its plugin refuses new comments
    When I open the Backlog parent page
    And I write "Keep me" in a new comment and press Mod+Enter
    Then the comment is not sent and the editor keeps "Keep me"
    And after a reload the comment field shows the draft "Keep me"

  Scenario: Edit my comment on a synced item
    Given the Backlog parent is synced
    And its plugin lists seven comments, two new from others since my last visit
    And its plugin accepts comment changes
    When I open the Backlog parent page
    And I edit my comment to "Code first, then the task name."
    Then my comment reads "Code first, then the task name." and shows it was edited

  Scenario: Undo deleting my comment
    Given the Backlog parent is synced
    And its plugin lists seven comments, two new from others since my last visit
    And its plugin accepts comment changes
    When I open the Backlog parent page
    And I delete my comment
    Then my comment is hidden
    When I undo the delete
    Then my comment shows again and no delete was sent

  Scenario: Delete my comment once the Undo toast closes
    Given the Backlog parent is synced
    And its plugin lists seven comments, two new from others since my last visit
    And its plugin accepts comment changes
    When I open the Backlog parent page
    And I delete my comment
    And the Undo toast closes on its own
    Then the delete was sent once

  Scenario Outline: Comment controls show hover and pressed feedback
    Given the Backlog parent is synced
    And its plugin lists seven comments, two new from others since my last visit
    When I open the Backlog parent page
    Then my comment controls show hover and pressed feedback in the "<theme>" theme

    Examples:
      | theme |
      | light |
      | dark  |

  Scenario: React to a comment
    Given the Backlog parent is synced
    And its plugin lists seven comments, two new from others since my last visit
    And its plugin accepts comment changes
    When I open the Backlog parent page
    And I add a Heart to Ana's reply
    Then Ana's reply shows my Heart

  Scenario: A comment from someone else brings a settled item back
    Given the Backlog parent is synced
    And the Backlog parent is settled and its next sync reports a comment from Ana
    When I reload the app
    Then the sync asked for the comments since the parent was settled
    And the parent has a Returned mark
    When I open the Backlog parent page
    Then its page says Ana commented, and still does once the mark is cleared

  Scenario: Settle a synced item with a comment
    Given the Backlog parent is synced
    And its plugin lists seven comments, two new from others since my last visit
    And its plugin settles items and records what it writes
    When I open the Backlog parent page
    And I settle it in Waiting with the comment "Waiting on the client"
    And the Undo toast closes on its own
    Then the source got the settle, then the comment "Waiting on the client"
    And my new comment "Waiting on the client" shows last in the thread

  Scenario: Undoing a settle keeps its comment as a draft
    Given the Backlog parent is synced
    And its plugin lists seven comments, two new from others since my last visit
    And its plugin settles items and records what it writes
    When I open the Backlog parent page
    And I settle it in Waiting with the comment "Waiting on the client"
    And I undo the settle
    Then nothing went to the source and the comment field shows the draft "Waiting on the client"

  Scenario: A settle comment stays a draft when its settle ends before it goes
    Given the Backlog parent is synced
    And its plugin lists seven comments, two new from others since my last visit
    And its plugin settles items and records what it writes
    When I open the Backlog parent page
    And I settle it in Waiting with the comment "Waiting on the client"
    And I unsettle it from its page header
    And I archive it from its properties card
    Then no comment went to the source and the comment field shows the draft "Waiting on the client"

  Scenario: Mention someone in a comment
    Given the Backlog parent is synced
    And its plugin lists seven comments, two new from others since my last visit
    And its plugin finds people and records posted comments
    When I open the Backlog parent page
    And I mention Ana in a new comment and send it
    Then the comment went out with Ana's mention, shown as a chip

  Scenario: Mention suggestions say when no one matches
    Given the Backlog parent is synced
    And its plugin lists seven comments, two new from others since my last visit
    And its plugin finds people and records posted comments
    When I open the Backlog parent page
    And I type "@" in a new comment
    Then the mention suggestions ask for a name
    When I keep typing "Zoe"
    Then the mention suggestions say no one was found
    When I keep typing " "
    Then the mention suggestions are closed

  Scenario: A failed people search reads as no one found
    Given the Backlog parent is synced
    And its plugin lists seven comments, two new from others since my last visit
    And its plugin fails to search people
    When I open the Backlog parent page
    And I type "@Ana" in a new comment
    Then the mention suggestions say no one was found
    When the people search works again and I ask for suggestions
    Then Ana is suggested and no status shows

  Scenario: A slow people search answers only the name still being typed
    Given the Backlog parent is synced
    And its plugin lists seven comments, two new from others since my last visit
    And its plugin finds no one, slowly
    When I open the Backlog parent page
    And I type "@Zo" in a new comment
    And I keep typing " " before the search answers
    Then the mention suggestions are closed once the search answers

  Scenario: Typing on while a people search runs searches the longer name
    Given the Backlog parent is synced
    And its plugin lists seven comments, two new from others since my last visit
    And its plugin finds people, slowly
    When I open the Backlog parent page
    And I type "@A" in a new comment
    And I keep typing "na" before the search answers
    Then Ana is suggested and no status shows

  Scenario: Archive a synced item from the bottom of its properties card
    Given the Backlog parent is synced
    When I open the Backlog parent page
    And I archive it from its properties card
    Then the Backlog parent is archived and its page offers Restore

  Scenario: Fold the Subitems and Time entries cards on the item page
    When I open the Backlog parent page
    Then the Subitems and Time entries cards are closed on their summary
    When I add the subitem "Folded subitem" on its page
    And I press Escape in the subitem name field
    Then the Subitems card is closed on "0 of 2 done" and the page has the focus
    When I open the Subitems card
    And I reload the item page
    Then the Subitems card is still open and Time entries is still closed

  Scenario: Fold the Subitems card from its title while adding a subitem
    When I open the Backlog parent page
    And I press Add subitem and then the Subitems title
    Then the Subitems card stays closed, even after a reload

  Scenario: Open the Subitems card with Enter after a right-click on its title
    When I open the Backlog parent page
    And I press Add subitem, right-click the Subitems title and press Enter
    Then the Subitems card is open

  Scenario: Keep a synced item when it goes missing from sync
    Given the Backlog parent is synced
    When I open the Backlog parent page
    And I set When missing to Keep on its properties card
    Then the Backlog parent is kept when missing from sync
    When I undo the When missing change
    Then the Backlog parent is archived when missing from sync
