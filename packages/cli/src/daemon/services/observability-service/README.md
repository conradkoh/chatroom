# Observability Service

Daemon-local, in-memory, diagnostic-only aggregation for operational
subscription activity.

## Ownership

The `OperationalObservabilityService` aggregates operational subscription
lifecycle, page/source, hydration, acknowledgement, error, and restart
counters in memory. It owns no timers, performs no network I/O, and never
touches Convex.

The task-inbox runtime creates exactly one service instance, passes it to
operational watchers as an in-process observer, and flushes
schema-versioned snapshots to the existing local event stream
(`session.logEvent`, served on `127.0.0.1`) at a bounded interval
(30 seconds, only when new data was recorded).

## Constraints

- Must not write to Convex, create subscriptions, or emit one record per
  signal. At most one aggregate snapshot is emitted per flush interval,
  and only when new data was recorded since the last flush.
- Must not log sensitive identifiers: no session ids, auth tokens, signal
  keys, revision keys, message content, or full rows. Snapshots carry only
  counts with bounded `chatroomId` / `role` attribution (`__other__`
  overflow buckets).
- A failed sink must not lose evidence: counters are retained and retried
  on the next flush.
- Future remote export is explicitly a separate decision and is out of
  scope. A local event-stream record is enough for source attribution.
