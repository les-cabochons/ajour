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

  Scenario: A synced description follows its source, read-only when the plugin cannot write it
    Given the Backlog parent is synced
    And its plugin, which does not write descriptions, sends the description "Written in the source" on its next sync
    When I reload the app
    And I open the Backlog parent page
    Then its description reads "Written in the source"
    And the description is read-only because the source keeps it, with Edit in source

  Scenario: A description cut to fit Ajour is read-only
    Given the Backlog parent is synced
    And its plugin, which writes descriptions, sends a description cut to "The first part" on its next sync
    When I reload the app
    And I open the Backlog parent page
    Then its description reads "The first part"
    And the description is read-only because it is cut, with Edit in source

  Scenario: A description whose conversion lost formatting is read-only
    Given the Backlog parent is synced
    And its plugin, which writes descriptions, sends the description "Underlined in the source", which lost its underline, on its next sync
    When I reload the app
    And I open the Backlog parent page
    Then its description reads "Underlined in the source"
    And the description is read-only because editing would lose its underline, with Edit in source

  Scenario: With lossy conversion allowed, saving a lossy description asks first, then writes
    Given the Backlog parent is synced
    And its description "Original", which lost its underline, is synced through a connection that allows lossy conversion
    When I reload the app
    And I open the Backlog parent page
    And I write "My notes" as its description and save it
    Then a dialog names the underline that saving loses
    When I choose "Save anyway" in the dialog
    Then the source was asked to write with the loss allowed
    And the source and the parent both hold "My notes"

  Scenario: Save anyway after a sync during the dialog keeps the colleague's change
    Given the Backlog parent is synced
    And its description "Goal\n\nSteps", which lost its underline, is synced through a connection that allows lossy conversion
    When I reload the app
    And I open the Backlog parent page
    And I start editing the description
    And I change the description to "My goal\n\nSteps"
    And I save the description without waiting
    Then a dialog names the underline that saving loses
    When a sync brings "Goal\n\nNew steps" while I edit
    And I choose "Save anyway" in the dialog
    Then the source and the parent both hold "My goal\n\nNew steps"

  Scenario: Cancel in the lossy save dialog writes nothing and keeps the edit
    Given the Backlog parent is synced
    And its description "Original", which lost its underline, is synced through a connection that allows lossy conversion
    When I reload the app
    And I open the Backlog parent page
    And I write "My notes" as its description and save it
    Then a dialog names the underline that saving loses
    When I choose "Cancel" in the dialog
    Then nothing was written, and the editor still holds "My notes"

  Scenario: A sync that finds a description conflict says so and leads to Sync review
    Given the Backlog parent is synced
    And its description was edited here to "My notes" since its last sync of "Original"
    And its plugin, which writes descriptions, sends the description "Their notes" on its next sync
    When I reload the app
    Then a toast says "Description conflict on Backlog parent"
    When I choose Resolve in the toast
    Then Sync review shows the parent's conflict highlighted, with "My notes" here and "Their notes" in the source
    When I take the source's description
    Then the parent's description is "Their notes" and its conflict is gone

  Scenario: The conflict mark leads to Sync review from the sidebar, the backlog and the item page
    Given the Backlog parent is synced
    And its description is in conflict between "My notes" here and "Their notes" in the source
    When I reload the app
    And I follow the conflict mark on the parent's sidebar row
    Then Sync review opens on the parent's conflict
    When I follow the conflict mark on the parent's backlog row
    Then Sync review opens on the parent's conflict
    When I follow the conflict mark beside the parent's description
    Then Sync review opens on the parent's conflict

  Scenario: An estimate conflict on a snoozed item still leads to Sync review
    Given the Backlog parent is synced
    And the parent is snoozed with its remaining estimate in conflict
    When I reload the app
    And I follow the conflict mark on the parent's snoozed sidebar row
    Then Sync review opens on the parent's estimate conflict
    When I follow the conflict mark beside the parent's remaining estimate
    Then Sync review opens on the parent's estimate conflict

  Scenario: Sync review compares the description as it is now
    Given the Backlog parent is synced
    And its description is in conflict with "Their notes" in the source, and was edited here since to "My newer notes"
    When I open Sync review on the parent
    Then Sync review shows "My newer notes" here, not the text from when the conflict began

  Scenario: Editing a synced description warns when the source changed, and loads the latest
    Given the Backlog parent is synced
    And its description "Original" is synced through a plugin that writes descriptions
    And someone changes it in the source to "Their newer notes" after the sync
    When I reload the app
    And I open the Backlog parent page
    And I start editing the description
    Then the editor warns that the description changed in the source, with Load latest
    When I load the latest description
    Then the description editor holds "Their newer notes", and the warning is gone

  Scenario: Saving a synced description writes it to the source
    Given the Backlog parent is synced
    And its description "Original" is synced through a plugin that writes descriptions
    When I reload the app
    And I open the Backlog parent page
    And I write "My notes" as its description and press Mod+Enter
    Then the source and the parent both hold "My notes"

  Scenario: Saving merges a source change to other lines
    Given the Backlog parent is synced
    And its description "Goal\n\nSteps" is synced through a plugin that writes descriptions
    And someone changes it in the source to "Their goal\n\nSteps" after the sync
    When I reload the app
    And I open the Backlog parent page
    And I start editing the description
    And I change the description to "Goal\n\nMy steps"
    Then the editor says saving will merge the changes
    When I save the description
    Then the source and the parent both hold "Their goal\n\nMy steps"

  Scenario: A sync during an edit joins the draft, so saving keeps both changes
    Given the Backlog parent is synced
    And its description "Goal\n\nSteps" is synced through a plugin that writes descriptions
    When I reload the app
    And I open the Backlog parent page
    And I start editing the description
    And I change the description to "My goal\n\nSteps"
    And a sync brings "Goal\n\nNew steps" while I edit
    Then the description editor holds both "My goal" and "New steps"
    When I save the description
    Then the source and the parent both hold "My goal\n\nNew steps"

  Scenario: Saving over a source change to the same lines is a conflict to resolve
    Given the Backlog parent is synced
    And its description "Goal" is synced through a plugin that writes descriptions
    And someone changes it in the source to "Their goal" after the sync
    When I reload the app
    And I open the Backlog parent page
    And I write "My goal" as its description and press Mod+Enter
    Then the description says it changed in the source too, with Resolve
    And the source still holds "Their goal", and the parent "My goal"
    When I choose Resolve beside the description
    Then Sync review opens on the parent's conflict

  Scenario: Keep mine writes the user's description to the source
    Given the Backlog parent is synced
    And its description is in conflict between "My notes" here and "Their notes" in a source that writes descriptions
    When I reload the app
    And I open Sync review on the parent
    And I keep my description
    Then the parent's description is "My notes" and its conflict is gone
    And the source and the parent both hold "My notes"

  Scenario: A description the source refuses stays, with why and Retry
    Given the Backlog parent is synced
    And its description "Original" is synced through a plugin that writes descriptions
    And the source refuses description writes with "The token expired."
    When I reload the app
    And I open the Backlog parent page
    And I write "My notes" as its description and press Mod+Enter
    Then the description says it is not saved to the source because "The token expired.", with Retry
    And the source still holds "Original", and the parent "My notes"

  Scenario: Following a conflict mark saves the side panel's draft first
    Given the Backlog parent is synced
    And its description is in conflict between "My notes" here and "Their notes" in the source
    When I open the Backlog workspace
    And I edit the parent item from the Backlog peek
    And I rename the parent to "Renamed in the panel" in the side panel without saving
    And I follow the conflict mark on the parent's sidebar row
    Then Sync review opens on the parent's conflict
    And the parent's title is "Renamed in the panel", saved on the way

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

  Scenario: Mention someone by their first and last name
    Given the Backlog parent is synced
    And its plugin lists seven comments, two new from others since my last visit
    And its plugin finds people and records posted comments
    When I open the Backlog parent page
    And I type "@Ana Sil" in a new comment
    Then Ana is suggested once the search is done
    When I pick Ana from the suggestions
    Then the new comment mentions "@Ana Silva" as a chip

  Scenario: Writing on after a name closes the suggestions without a status
    Given the Backlog parent is synced
    And its plugin lists seven comments, two new from others since my last visit
    And its plugin finds people and records posted comments
    When I open the Backlog parent page
    And I type "@Ana" in a new comment
    Then Ana is suggested once the search is done
    When I keep typing " thanks" until the search for "Ana thanks" answers
    Then nothing is suggested and no status shows

  Scenario Outline: Typing an email does not start a mention search
    Given the Backlog parent is synced
    And its plugin lists seven comments, two new from others since my last visit
    And its plugin finds people and records posted comments
    And I watch people search requests
    When I open the Backlog parent page
    And I type "<text>" in a new comment
    Then no mention suggestions or searches appear
    And nothing is suggested and the new comment stays open with "<text>"

    Examples:
      | text                                      |
      | alex@                                     |
      | alex@gmail.com                            |
      | write to first.last+tag@example.com        |
      | write to team@Ana                         |

  Scenario Outline: Standalone mentions still open the people picker
    Given the Backlog parent is synced
    And its plugin lists seven comments, two new from others since my last visit
    And its plugin finds people and records posted comments
    When I open the Backlog parent page
    And I type "<text>" in a new comment
    Then Ana is suggested once the search is done

    Examples:
      | text                              |
      | @Ana                              |
      | Hello @Ana                        |
      | (@Ana                             |
      | Email alex@gmail.com then @Ana     |

  Scenario: Escape closes the mention suggestions before the editor
    Given the Backlog parent is synced
    And its plugin lists seven comments, two new from others since my last visit
    And its plugin finds people and records posted comments
    When I open the Backlog parent page
    And I type "@Ana" in a new comment
    Then Ana is suggested once the search is done
    When I press Escape in the new comment
    Then nothing is suggested and the new comment stays open with "@Ana"
    When I keep typing " Sil"
    Then no people search ran since Escape
    When I press Escape in the new comment
    Then the new comment is closed, keeping the draft "@Ana Sil"

  Scenario: Escape stops a mention search that is still running
    Given the Backlog parent is synced
    And its plugin lists seven comments, two new from others since my last visit
    And its plugin finds no one, slowly
    When I open the Backlog parent page
    And I type "@Zoe" in a new comment
    And I press Escape in the new comment while the search runs
    Then nothing is suggested and the new comment stays open with "@Zoe"

  Scenario: Escape after asking again stops the search, not the editor
    Given the Backlog parent is synced
    And its plugin lists seven comments, two new from others since my last visit
    And its plugin finds no one, slowly
    When I open the Backlog parent page
    And I type "@Zoe" in a new comment
    And I press Escape, ask again and press Escape while the first search runs
    Then nothing is suggested and the new comment stays open with "@Zoe"

  Scenario: Escape stops a mention search before it starts
    Given the Backlog parent is synced
    And its plugin lists seven comments, two new from others since my last visit
    And its plugin finds people and records posted comments
    When I open the Backlog parent page
    And I type "@Ana" in a new comment
    And I press Escape in the new comment
    Then no people search ran since Escape
    And nothing is suggested and the new comment stays open with "@Ana"

  Scenario: Escape right after writing closes the editor
    Given the Backlog parent is synced
    And its plugin lists seven comments, two new from others since my last visit
    And its plugin finds people and records posted comments
    When I open the Backlog parent page
    And I type "Looks good" in a new comment
    And I press Escape in the new comment
    Then the new comment is closed, keeping the draft "Looks good"

  Scenario: A new @ in place of a dismissed one suggests again
    Given the Backlog parent is synced
    And its plugin lists seven comments, two new from others since my last visit
    And its plugin finds people and records posted comments
    When I open the Backlog parent page
    And I type "@Ana" in a new comment
    Then Ana is suggested once the search is done
    When I press Escape in the new comment
    And I select all and type "@Ana"
    Then Ana is suggested once the search is done

  Scenario: Escape closes a mention status line before the editor
    Given the Backlog parent is synced
    And its plugin lists seven comments, two new from others since my last visit
    And its plugin finds people and records posted comments
    When I open the Backlog parent page
    And I type "@Zoe" in a new comment
    Then the mention suggestions say no one was found
    When I press Escape in the new comment
    Then nothing is suggested and the new comment stays open with "@Zoe"

  Scenario: A bare @ with no one to suggest asks for a name
    Given the Backlog parent is synced
    And its plugin lists seven comments, two new from others since my last visit
    And its plugin finds no one, slowly
    When I open the Backlog parent page
    And I type "@" in a new comment
    Then the mention suggestions say they are searching
    And the mention suggestions ask for a name

  Scenario: The suggestions stay open while a name is searched
    Given the Backlog parent is synced
    And its plugin lists seven comments, two new from others since my last visit
    And its plugin finds people, slowly
    When I open the Backlog parent page
    And I type "@" in a new comment
    Then the mention suggestions say they are searching
    And Ana and Andrew are suggested, with their emails
    When I keep typing "And"
    Then Ana and Andrew stay in view while it searches
    And Andrew alone is suggested once the search is done

  Scenario: Pick a person with the keyboard
    Given the Backlog parent is synced
    And its plugin lists seven comments, two new from others since my last visit
    And its plugin finds people and records posted comments
    When I open the Backlog parent page
    And I type "@An" in a new comment
    Then Ana is suggested once the search is done
    When I move down the suggestions and press Enter
    Then the new comment mentions "@Andrew Lee" as a chip

  Scenario: Picking with the cursor inside a name replaces the whole name
    Given the Backlog parent is synced
    And its plugin lists seven comments, two new from others since my last visit
    And its plugin finds people and records posted comments
    When I open the Backlog parent page
    And I type "@Ana" in a new comment
    Then Ana is suggested once the search is done
    When I move back 2 characters and ask for suggestions
    And I pick Ana from the suggestions
    Then the new comment reads only the mention "@Ana Silva"

  Scenario: Picking with the cursor inside a first and last name replaces both
    Given the Backlog parent is synced
    And its plugin lists seven comments, two new from others since my last visit
    And its plugin finds people and records posted comments
    When I open the Backlog parent page
    And I type "@Ana Silva" in a new comment
    Then Ana is suggested once the search is done
    When I move back 8 characters and ask for suggestions
    And I pick Ana from the suggestions
    Then the new comment reads only the mention "@Ana Silva"

  Scenario: Moving through the name the picker was asked from keeps it open
    Given the Backlog parent is synced
    And its plugin lists seven comments, two new from others since my last visit
    And its plugin finds people and records posted comments
    When I open the Backlog parent page
    And I type "@Ana Silva" in a new comment
    Then Ana is suggested once the search is done
    When I move back 8 characters and ask for suggestions
    Then Ana is suggested once the search is done
    When I move forward 1 characters
    And I pick Ana from the suggestions
    Then the new comment reads only the mention "@Ana Silva"

  Scenario: Words after two spaces stay when picking
    Given the Backlog parent is synced
    And its plugin lists seven comments, two new from others since my last visit
    And its plugin finds people and records posted comments
    When I open the Backlog parent page
    And I type "@Ana please" in a new comment
    And I move back 7 characters and ask for suggestions
    Then Ana is suggested once the search is done
    When I keep typing " "
    And I pick Ana from the suggestions
    Then the new comment reads "@Ana Silva please"

  Scenario: Picking a mention typed against a word keeps the word
    Given the Backlog parent is synced
    And its plugin lists seven comments, two new from others since my last visit
    And its plugin finds people and records posted comments
    When I open the Backlog parent page
    And I type "please review" in a new comment
    And I go to the start of the line and type "@Ana"
    Then Ana is suggested once the search is done
    When I pick Ana from the suggestions
    Then the new comment reads "@Ana Silva please review"

  Scenario: Picking at the start of a last name replaces it once
    Given the Backlog parent is synced
    And its plugin lists seven comments, two new from others since my last visit
    And its plugin finds people and records posted comments
    When I open the Backlog parent page
    And I type "@Ana Silva" in a new comment
    Then Ana is suggested once the search is done
    When I move back 5 characters
    And I pick Ana from the suggestions
    Then the new comment reads only the mention "@Ana Silva"

  Scenario: Picking before a last name and a comma keeps the comma
    Given the Backlog parent is synced
    And its plugin lists seven comments, two new from others since my last visit
    And its plugin finds people and records posted comments
    When I open the Backlog parent page
    And I type "@Ana Silva, please review" in a new comment
    And I move back 21 characters and ask for suggestions
    Then Ana is suggested once the search is done
    When I pick Ana from the suggestions
    Then the new comment reads "@Ana Silva, please review"

  Scenario: Picking inside a last name typed alone replaces it
    Given the Backlog parent is synced
    And its plugin lists seven comments, two new from others since my last visit
    And its plugin finds people and records posted comments
    When I open the Backlog parent page
    And I type "@Silva" in a new comment
    Then Ana is suggested once the search is done
    When I move back 2 characters and ask for suggestions
    And I pick Ana from the suggestions
    Then the new comment reads only the mention "@Ana Silva"

  Scenario: Picking inside the last name of someone with a middle name replaces it
    Given the Backlog parent is synced
    And its plugin lists seven comments, two new from others since my last visit
    And its plugin finds Ana Maria Silva for any name
    When I open the Backlog parent page
    And I type "@Ana Silva, please review" in a new comment
    And I move back 17 characters and ask for suggestions
    And I pick "Ana Maria Silva" from the suggestions
    Then the new comment reads "@Ana Maria Silva, please review"

  Scenario: Picking before other words keeps them
    Given the Backlog parent is synced
    And its plugin lists seven comments, two new from others since my last visit
    And its plugin finds people and records posted comments
    When I open the Backlog parent page
    And I type "please review" in a new comment
    And I go to the start of the line and type "@Ana "
    Then Ana is suggested once the search is done
    When I pick Ana from the suggestions
    Then the new comment reads "@Ana Silva please review"

  Scenario: An older answer never replaces a newer one for the same name
    Given the Backlog parent is synced
    And its plugin lists seven comments, two new from others since my last visit
    And its plugin answers its first search for Ana late, with no one
    When I open the Backlog parent page
    And I type "@Ana" in a new comment
    And I type "x" and take it back while the first search for Ana runs
    Then Ana is still suggested after the late answer

  Scenario: Enter waits for the search instead of starting a new line
    Given the Backlog parent is synced
    And its plugin lists seven comments, two new from others since my last visit
    And its plugin finds people, slowly
    When I open the Backlog parent page
    And I type "@Ana" in a new comment
    And I press Enter in the new comment
    Then the new comment still reads "@Ana" while the picker searches
    And Ana is suggested once the search is done
    When I press Enter in the new comment
    Then the new comment mentions "@Ana Silva" as a chip

  Scenario: The picker follows its @ when the line moves
    Given the Backlog parent is synced
    And its plugin lists seven comments, two new from others since my last visit
    And its plugin finds people and records posted comments
    When I open the Backlog parent page
    And I type "First line" in a new comment
    And I press Enter in the new comment
    And I keep typing "@Ana"
    Then Ana is suggested once the search is done
    When I move the line up with Alt+ArrowUp
    Then the picker sits by the line with "@Ana"

  Scenario: Mention suggestions say when no one matches
    Given the Backlog parent is synced
    And its plugin lists seven comments, two new from others since my last visit
    And its plugin finds people and records posted comments
    When I open the Backlog parent page
    And I type "@" in a new comment
    Then Ana and Andrew are suggested, with their emails
    When I keep typing "Zoe"
    Then the mention suggestions say no one was found
    When I keep typing " "
    Then the mention suggestions are closed

  Scenario: No one found goes once the cursor leaves the name it answers
    Given the Backlog parent is synced
    And its plugin lists seven comments, two new from others since my last visit
    And its plugin finds people and records posted comments
    When I open the Backlog parent page
    And I type "@Zoe thanks" in a new comment
    And I move back 7 characters and ask for suggestions
    Then the mention suggestions say no one was found
    When I move forward 2 characters
    Then the mention suggestions are closed

  Scenario: A failed people search reads as no one found
    Given the Backlog parent is synced
    And its plugin lists seven comments, two new from others since my last visit
    And its plugin fails to search people
    When I open the Backlog parent page
    And I type "@Ana" in a new comment
    Then the mention suggestions say no one was found
    When the people search works again and I ask for suggestions
    Then Ana is suggested once the search is done

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
    Then Ana is suggested once the search is done

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

  Scenario: Refresh backlog from its freshness control
    Given a source is ready for a backlog refresh
    When I refresh from the backlog freshness control
    Then the backlog freshness control shows a small neutral spinning icon and syncing text
    When the source finishes the backlog refresh
    Then the refreshed source title is visible in the backlog

  Scenario: Refresh only the open backlog item
    Given a source is ready for a backlog refresh
    When I open the Backlog parent page
    And I refresh from the item freshness control
    Then the item freshness control shows syncing text
    When the source finishes the backlog refresh
    Then the open item shows the refreshed source title
