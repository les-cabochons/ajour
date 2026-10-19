# Pull request writes are sent at once, without the Undo window

ADR 0001 holds connector writes until the Undo toast closes, because settling is a one-key action that can be a misclick. Pull request writes are different. Submitting a review, posting or resolving a comment, editing the title, toggling draft and merging are each a deliberate action on a pull request the user is looking at. Ajour sends them to the code host as soon as the user acts. A failed write keeps the draft review or the edit and offers a retry. Nothing is queued for a later launch. Merge alone asks for confirmation first, because it cannot be undone. Settling or snoozing a pull request stays local and writes nothing.

## Considered options

- **Reuse the Undo window from ADR 0001.** Rejected. A comment or review that appears seconds late confuses the people waiting on it, and merge cannot be compensated.
- **Queue writes made offline and flush them at launch.** Rejected. A review or merge sent hours later, against commits the user never saw, does more harm than a visible failure.
