# Connector writes go through an optional plugin capability and are sent after the Undo window

Settling a synced backlog item can change its state and priority in Azure DevOps or Jira. We add an optional capability to the connector plugin contract for this, instead of hard-wiring each source in Ajour. Plugins that don't implement it keep working, and their items settle locally. The write is not sent when the user confirms. Ajour saves it locally and sends it once the Undo toast closes, or at the next launch if Ajour quit first. That way Undo stays cheap and honest even for an action that reaches outside Ajour, and the spec's "undo instead of confirmation" rule covers settle too.

## Considered options

- **Write at once, no Undo.** This matches the spec's confirmation rule for remote writes, but a misclick on E, or on the sidebar's Settle button with an Apply rule, would change the source tool with no way back.
- **Write at once, Undo sends a compensating write.** This was rejected because the previous state can be unreachable through the source's workflow rules, and it doubles the traffic.
- **Hard-wired Azure DevOps and Jira code in Ajour.** This was rejected because connectors are standalone plugins (`ajc-azure-devops`, `ajc-jira`), and the host should not know source APIs.

## Consequences

- The contract change spans three repositories: this one, `ajc-azure-devops` (first) and `ajc-jira`.
- A pending write can outlive the session. Ajour must persist it and flush it at startup.
- A failed write restores the last confirmed source values and their local lifecycle. A first failed settle returns the item to active. If an earlier in-flight write succeeds before its replacement fails, recovery uses that successful snapshot. An error toast stays until dismissed and explains the failure.
