# Deck's chat may make any review write the user can, shown as action lines

Deck's chat (#796) is the fallback for what the asks don't cover, and the user can ask it to act, not only to answer: add a draft comment, post a comment, reply, resolve a thread, vote or submit a review, regroup the guide, and, on their own pull request, edit the title or toggle draft. Until now an agent in Ajour wrote only the user's local data, behind an Undo window (ADR 0001), or a guide that stays on the user's computer. These writes reach the code host in the user's name, and other people read them at once. We decided the chat's agent may make them, as tools of its pull request conversation, and that each one is visible and deletable instead of held for confirmation. It sits beside [ADR 0002](0002-pull-request-writes-are-immediate.md): writes are still sent at once, with no Undo window and nothing queued.

- **Only in a chat turn.** The tools are listed for every turn of the conversation, as `submit_guide` is (#794), but Ajour takes them only while a `deck.chat` turn the user started runs, at that turn's head, and while the repository is allowed with the conversation's agent. An ask or a guide turn that calls one is refused, so a question never posts anything.
- **What the page allows.** Each tool goes through the same code host operations, access choices and plugin admission as the user's own writes. Title and draft writes are refused unless the page said the user authored the pull request when it sent the message. A draft comment goes to the draft review in the window, over the bridge's data tools, and nothing reaches the code host until the user sends Finish review. The chat's `submit_review` sends a verdict and a summary only: the draft review stays the user's.
- **One action line per write.** Each write comes back to the window as an `action` event of its turn: what it did, a link to where it shows, and, for a comment, a reply or a draft comment it added, Delete. Delete removes a posted comment through the code host's `deleteComment`, or a draft comment from the draft review. A code host without `deleteComment` keeps the link, and the line says to delete it there.
- **Never merge.** Merge is not one of the tools, and a call of any tool name that says merge is refused with `merge_refused`. Merging stays a confirmed action of the user's (ADR 0002), because it can't be undone and no action line can delete it.

## Considered options

- **Ask the user to confirm each write in the chat.** Rejected. The user already asked for the write in their message; a second click for each line makes the chat slower than doing it by hand, and the asks are there for reading. A write the user didn't want is deleted from its line.
- **Let the chat only draft, and post nothing.** Rejected. Replying to and resolving threads is most of what a reviewer asks for after reading, and a draft can't hold a reply or a resolve.
- **Hold the writes behind ADR 0001's Undo window.** Rejected for the reasons ADR 0002 gives: comments that appear late confuse the people waiting on them.
- **Offer merge behind a confirmation.** Rejected. One misread instruction would merge code the user never approved, and the review page already has Merge one click away.

## Consequences

- The consent the user gave for asks covers the chat: a message sends what an ask sends, the user's words, the code the agent reads and the threads, and nothing more. A chat regroup reads only what the agent reads, so it doesn't need the regroup's wider consent (#794).
- What the chat posts is the user's on the code host: the privacy policy and Deck's page say so, and that a deleted comment's earlier notifications stay with the people who got them.
- A plugin that implements `deleteComment` lets the chat's Delete work on that code host; the official plugins add it in #960.
