# Pull request list, lifecycle, and sidebar

Issue: #78. Base: `feat/catalog-capabilities`, pending #96 and #101.
Behavior: `docs/superpowers/specs/2026-10-11-code-host-pull-requests-design.md`.

## Implementation

- [x] Define local pull request records and deterministic sync/lifecycle transitions
      in `apps/web/src/domain/pull-requests`. Scope identity by plugin, connection,
      repository, and number. Keep successful sync facts as the baseline, preserve
      local choices, hide filtered or inaccessible items, and expire closed items
      after seven days.
- [x] Add review-request event facts to the shared contract and GitHub plugin so
      a re-request between syncs and its actor can be identified.
- [x] Wire local persistence, validated API calls, serialized connection sync,
      automatic sync, and immediate visibility changes on plugin deactivation.
- [x] Add the grouped list and a summary detail route, with local settle,
      unsettle, snooze, returned acknowledgement, and source links. The full review
      client, time actions, cache, and repository rules belong to later slices.
- [x] Add the active pull request section above backlog items, ordered by the
      event that made each item active. Preserve the backlog-only Settled section.
- [x] Add the shared Changes end a snooze early setting. Apply it to pull request
      events and source state or priority changes on synced backlog items.
- [x] Confirm connection removal before clearing its pull requests. Retain local
      records when a plugin is disabled or uninstalled.
- [x] Support modified-click source navigation and Open in source menus on pull
      requests and every backlog row surface.

## Verification

Test every lifecycle table row, own actions, bots, team requests, re-requests,
repeated and failed syncs, connection isolation, snooze expiry and both setting
values, closed expiry, and filtered reappearance. Add persistence/API integration
checks and Chromium scenarios for the list, sidebar, local actions, source
navigation, plugin visibility, and connection deletion. Run `just test`,
`just typecheck`, `just build`, and `just format-check`. Use an isolated browser
server port because another checkout may own port 4173.
