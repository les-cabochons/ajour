# Logging Strategy

This repo should adopt a wide-events logging model inspired by:

- [loggingsucks.com](https://loggingsucks.com/)
- [Stripe canonical log lines](https://stripe.com/blog/canonical-log-lines)
- [Observability wide events 101](https://boristane.com/blog/observability-wide-events-101/)

## Decision

We will log one structured, context-rich event per meaningful operation per runtime boundary.

In this repo, "meaningful operation" does not mean every function call or UI render. It means things like:

- a timer being started or saved
- a timesheet entry being committed
- an app API request completing

We will not use scattered `console.log()` calls as the primary debugging model.

## Why This Fits Ajour

This app is split across multiple runtimes:

- `apps/web`
- `apps/api`
- `apps/desktop`

Wide events fit that shape well because each runtime can emit one authoritative record for its part of a flow, keyed by shared IDs where possible.

The privacy model changes how we apply the pattern:

- raw activity stays local
- uncommitted notes stay local
- dismissed activity stays local
- rules are sensitive and must be treated as such

That means our logging strategy must be wide-event-driven and privacy-scoped, not "log everything everywhere."

## Goals

- Make debugging operational flows queryable without grep-heavy text logs.
- Preserve the local-first privacy boundary from [local-first-architecture.md](./local-first-architecture.md).
- Keep event names and field names consistent across runtimes.
- Make logs useful for both debugging and product analytics.

## Non-Goals

- Logging every internal helper call.
- Logging React renders, polling loops, or state snapshots on every change.
- Shipping raw activity or private content to remote logging backends.
- Treating OpenTelemetry alone as the strategy. OTel can carry the data later, but it does not decide the schema for us.

## Core Rules

1. Emit JSON only.
2. Emit one wide event at operation completion, usually in a `finally` block or equivalent completion path.
3. Keep only two levels: `info` and `error`.
4. Prefer nested objects over flattened ad hoc field names when they represent a real domain concept.
5. Use stable IDs, counts, durations, flags, and statuses instead of human prose.
6. Never log unstructured strings as the primary record of an operation.

## Privacy Rules

The privacy boundary is stricter than a normal SaaS app. These fields must never go to a remote sink by default:

- raw URLs
- query strings
- URL fragments
- full page titles
- full window titles
- uncommitted notes
- dismissed or private activity details
- unaccepted rule proposals

For local-only diagnostics, we can be somewhat richer, but we should still prefer sanitized values over originals.

### Safe-by-default fields

These are acceptable as the default business context:

- internal IDs like `project_id`, `task_id`, `team_id`, `entry_id`
- runtime and deployment fields
- `domain`
- sanitized `pathname` or `pathname_depth`
- `fingerprint`
- source kind like `extension_bridge`, `manual`, `macos_agent`
- counts, durations, confidence, mixed-bucket flags, rule match outcomes

### Remote sink policy

Until the product has explicit consent and a stronger privacy review, diagnostics should default to local-only storage.

If a remote sink is introduced later, it should accept only explicitly remote-safe aggregate events and operational status, never raw activity details.

## Two Sinks

### 1. Local diagnostic sink

Use this for `apps/web`, `apps/api`, and `apps/desktop`.

Properties:

- enabled in development by default
- available in production only behind an explicit debug setting
- stored locally only
- retained as a bounded ring buffer

Recommended retention:

- last 5,000 events or last 7 days, whichever is smaller

### 2. Optional remote operational sink

Use this only for explicitly remote-safe app events if the product later adds an external service.

Properties:

- structured JSON
- no raw activity payloads
- no PII like email addresses
- ready for aggregation and alerting

## Common Event Envelope

Every wide event should include this envelope:

```json
{
  "ts": "2026-04-15T14:23:11.118Z",
  "event_name": "web.timesheet.entry_committed",
  "level": "info",
  "outcome": "success",
  "duration_ms": 42,
  "service": "ajour-web",
  "runtime": "web",
  "env": "development",
  "app_version": "0.1.0",
  "git_sha": "abc1234",
  "operation_id": "op_7f2...",
  "trace_id": "trace_7f2...",
  "session_id": "sess_3cd...",
  "privacy_tier": "local_only"
}
```

Add domain-specific objects under the envelope instead of inventing one-off root fields.

Recommended nested objects:

- `actor`
- `workspace`
- `activity`
- `timesheet`
- `project`
- `rule`
- `bridge`
- `agent`
- `http`
- `error`

## Required Shared Fields

These field names should stay consistent across runtimes.

```text
event_name
level
outcome
duration_ms
service
runtime
env
app_version
git_sha
operation_id
trace_id
session_id
privacy_tier
error.type
error.code
error.message
```

When available, also include:

```text
actor.user_id
workspace.team_id
workspace.local_date
project.project_id
project.task_id
activity.source
activity.domain
activity.pathname
activity.fingerprint
activity.duration_ms
activity.bucket_count
activity.segment_count
activity.confidence
activity.is_mixed
```

## Event Catalog By Runtime

### `apps/web`

The web app should log one wide event per user mutation, not per render and not per polling tick.

Start with:

- `web.timer.started`
- `web.timer.updated`
- `web.timer.saved`
- `web.timesheet.manual_saved`
- `web.timesheet.entry_updated`
- `web.timesheet.entry_deleted`
- `web.timesheet.entry_committed`
- `web.rule.saved`

First instrumentation points:

- [local-store.ts](../apps/web/src/lib/local-store.ts)
- [app-api.ts](../apps/web/src/lib/app-api.ts)

## Event Shape Examples

### Web: browser bucket import

```json
{
  "ts": "2026-04-15T14:23:11.118Z",
  "event_name": "web.browser_buckets.imported",
  "level": "info",
  "outcome": "success",
  "duration_ms": 31,
  "service": "ajour-web",
  "runtime": "web",
  "privacy_tier": "local_only",
  "workspace": {
    "team_id": "local_team",
    "local_date": "2026-04-15"
  },
  "bridge": {
    "request_type": "TT_GET_BUCKETS",
    "available": true,
    "paused": false
  },
  "activity": {
    "source": "extension_bridge",
    "bucket_count": 12,
    "mixed_bucket_count": 3,
    "domain_count": 5,
    "max_confidence": 0.91
  }
}
```

## Sampling And Retention

Wide events are information-dense, but some flows are still high-volume.

Use tail-style retention rules:

1. Keep 100% of `error` events.
2. Keep 100% of user mutations like commit, import, save, delete, pair, ingest.
3. Keep 100% of security-sensitive events like auth, pairing, or permission changes.
4. Sample or disable high-frequency healthy status checks.

Recommended starting policy:

- `web`: keep all mutation events, drop polling/status noise
- `extension`: keep finalized segments and failures, sample healthy repeated status pings at 10% if needed
- `agent`: keep HTTP completions and aggregation work, drop raw sampling loop noise

## Implementation Plan

### Phase 1

Add a shared logger contract and instrument the real runtime boundaries first:

- `apps/api/src/server.ts`
- `apps/web/src/lib/app-api.ts`

### Phase 2

Instrument local business mutations in:

- `apps/web/src/lib/local-store.ts`

### Phase 3

Add a local diagnostics viewer to the existing debug/settings surface so logs are inspectable without shipping private data off-device.

### Phase 4

Only after the schema is stable, add transport integration such as OpenTelemetry or a vendor sink.

## Anti-Patterns To Ban

- `console.log("something happened")`
- logging inside React render paths
- multiple partial log lines for one operation
- shipping raw titles or raw URLs to remote logging
- using email as the main user identifier
- emitting separate "started", "middle", and "finished" logs for the same small operation when one completion event is enough

## Bottom Line

For this repo, a "wide event" should mean:

- one event per meaningful completed operation
- structured JSON only
- consistent field names across runtimes
- local-first by default for privacy-sensitive activity
- remote logging only for remote-safe operational data

That keeps the core benefit from wide events, high-cardinality and high-dimensional context, without violating the product's privacy boundary.
