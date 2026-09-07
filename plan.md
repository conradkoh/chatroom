# Agent lifecycle coordination plan

- [x] Integrate the agent process manager command queue as the single entry point for serial execution of chatroom + role agent operations.
  - [x] Define FIFO command messages and lifecycle command entities.
  - [x] Implement per-group ordering, receipt handles, visibility timeouts, retries, and deduplication support.
  - [x] Add the in-memory command-queue store strategy and component constructor.
  - [x] Add send, receive, delete, and visibility-change use cases.
  - [x] Add the dedicated queue consumer and command dispatcher.
  - [x] Add the `AgentProcessManagerService` interface and queue-backed adapter.
  - [x] Add imperative start, stop, and restart command submission.
  - [x] Add the in-process command completion notifier and filtered subscriptions.
  - [x] Make notifier dependencies mandatory and add serialization/completion tests.
  - [x] Add cancellable, timeout-bounded compound operations for one agent key.
  - [x] Route start, stop, restart, and legacy daemon flows through the queue.

## Next goal

- [x] Add a scoped Agent Process Manager reset operation that restores a known state by stopping/clearing selected managed agent state, purging commands in the selected queue scope, and notifying affected callers that their operations were cancelled.
  - [x] Support chatroom-wide reset across all roles.
  - [x] Support chatroom-role reset for one role.
  - [x] Make queue purge scope explicit with an input union instead of optional arguments.
  - [x] Add cancellation notifications, completion rejection, documentation, and focused tests.
- [x] Wire `AgentProcessManagerService` into daemon startup and shutdown.
- [ ] Migrate the first lifecycle flow.
  - [x] Expose `AgentProcessManagerService` through the runtime dependency graph.
  - [x] Migrate native cold-session stop/start sequencing as the pilot flow.
  - [x] Preserve completion-dependent follow-up work and failure handling.
  - [x] Verify same-key ordering for service operations and competing queued commands.
  - [x] Add focused tests for the migrated flow and timeout/cancellation behavior.
  - [x] Remove compatibility fallbacks and verify competing legacy-path behavior.
  - [x] Migrate native pending-task activation to explicit `startAgent` calls through serialized coordination.
  - [x] Migrate `agent.requestStart` through the queue-backed process manager service.
  - [x] Migrate restart stop/start orchestration through one serialized agent operation.
  - [x] Coordinate role-scoped stop target execution through the process manager service.
  - [x] Coordinate chatroom-scoped exact-target stops per agent key.
  - [x] Migrate shutdown lifecycle calls to the queue-backed service and remove former recovery callers.
  - [x] Remove canonical task-orchestration wake/revive recovery starts.
  - [x] Migrate the remaining active start, stop, restart, recovery, and shutdown callers.
  - [x] Verify remaining direct manager references are limited to compatibility adapters and the
        process-manager implementation, with active lifecycle entry points using the queue-backed service.

## Pre-cleanup audit

- [x] Inventory every remaining agent lifecycle caller and classify it as migrated, internal, or compatibility-only.
  - [x] Search UI, command-inbox, event-listener, task-delivery, restart, recovery, shutdown, and enhancer flows.
  - [x] Confirm active production entry points use the queue-backed service or serialized capability.
  - [x] Keep process-exit bookkeeping below the service boundary; automatic crash/restart recovery is removed.
  - [x] Ensure manager-internal safety stops, including resume-storm stops, share the per-agent serialization boundary.
- [ ] Verify every service dependency is mandatory in production wiring.
  - [x] Remove optional `processManagerService` dependencies and inline serialized-operation fallbacks in daemon services.
  - [x] Make task-inbox delivery and native task-delivery coordinator serialization dependencies mandatory.
  - [x] Confirm daemon initialization starts the queue consumer before lifecycle commands can be awaited.
- [x] Define and verify completion semantics for every migrated caller.
  - [x] Confirm callers that require ordering await service promises.
  - [x] Confirm intentional fire-and-forget callers handle rejection or subscribe to notifications.
  - [ ] Confirm operation timeouts and cancellation signals are present for every remaining compound lifecycle operation, including manager-internal safety stops.
- [x] Audit per-key coverage for multi-agent operations.
  - [x] Verify chatroom-scoped stops serialize independently per role.
  - [x] Verify UI start, stop, and restart actions use the same service boundary.
  - [x] Verify native delivery, recovery, and restart flows use the per-agent key.
- [ ] Audit secondary lifecycle-triggering use cases that were not part of the first migration.
  - [x] Route resume-storm abort stops through the shared per-agent serialization boundary.
  - [x] Verify automatic crash/exit restart recovery has been removed; retain exit bookkeeping inside the manager.
  - [ ] Review enhancer/native harness stop paths and classify them as agent lifecycle or child-process cleanup.

## Recovery-boundary review

- [x] Phase 1 — Remove automatic recovery from `AgentProcessManager` and the lifecycle runtime.
  - [x] Remove automatic process-exit restart, session-reopen retry, resume-storm recovery, crash-loop gating, and recovery backoff.
  - [x] Retain explicit start, stop, restart, normal process-exit bookkeeping, and process cleanup.
  - [x] Remove the manager's daemon-memory session-retention state, resume path, and manager tests.
  - [ ] Remove provider adapter resume APIs and reconnect metadata and their tests.
  - [x] Remove preserve-for-resume stop options from lifecycle ports and harness stop implementations.
- [x] Phase 2 — Remove the explicit `recover` command from the queue-backed service.
  - [x] Remove the command entity, dispatcher branch, service API, execution-port method, and service tests.
  - [x] Keep explicit lifecycle commands as the only queue-managed operations.
- [x] Phase 3 — Remove daemon-startup state recovery.
  - [x] Remove the startup recovery handler, bridge, use case, initialization call, and recovery-specific tests.
  - [x] Ensure daemon startup begins with no recovered agents; shutdown/reset clears managed state instead.
- [x] Phase 4 — Remove recovery-specific task delivery and orchestration.
  - [x] Remove wake/revive recovery triggers, recovery suppression from reconciliation, and recovery assertions from orchestration tests.
  - [x] Retain normal pending-task delivery when explicitly requested.
  - [x] Delete the orphaned wake/revive helper implementations, cooldown state, and cooldown tests.
- [x] Phase 5 — Remove native harness/session recovery.
  - [x] Remove session-exit recovery, session reinjection, proactive recovery triggers, and recovery-only native delivery paths.
  - [x] Retain explicit task injection and lifecycle operations.
  - [x] Delete daemon-memory session retention/resume helpers and native session-loss recovery gating.
  - [ ] Delete remaining provider-specific resume/reconnect adapter implementations and tests.
  - [x] Delete the unused session-monitor recovery registry and no-op monitor.
- [x] Phase 6 — Remove orphaned recovery artifacts.
  - [x] Remove recovery-only session policies, restart decisions, session-reopen constants, monitors, and tests after production callers are gone.
  - [x] Update comments, READMEs, discovery documentation, and plan status.
- [x] Phase 7 — Verify state clearing and remaining lifecycle boundaries.
  - [x] Verify reset/queue cancellation, daemon startup/shutdown wiring, and writable isolated runtime test fixtures.
  - [x] Remove stale startup-recovery assertions and retain explicit lifecycle boundary coverage.
  - [x] Run daemon runtime/init tests and CLI typecheck successfully.

## Cleanup

- [x] Remove the unused `EnsureRunningResult` type from the start use case.
- [x] Remove the unused restart session-wait PID parameter.
- [x] Remove `NativeInjectorAgentMgr.stop()` and `.ensureRunning()` after all injector callers use serialized operations.
- [x] Remove obsolete lifecycle adapter properties from restart, native delivery, and task orchestration wiring.
- [x] Replace the empty-target stop fallback with the serialized `processManagerService` stop capability.
- [x] Make `processManagerService` mandatory in `DaemonAgentProcessManagerServiceLive`.
- [x] Remove inline no-op serialized-operation fallbacks from scoped stop wiring.
- [x] Extract shared lifecycle timeout values into named constants.
- [ ] Remove legacy lifecycle methods from the Effect manager boundary once downstream consumers are migrated.
- [ ] Remove transitional tests, casts, and compatibility-only test fixtures.
- [x] Remove the compatibility branch from production `handleTaskInboxUpdate`; keep remaining legacy coverage behind an explicitly named temporary adapter.
  - [x] Delete `handleLegacyTaskInboxUpdate`, its temporary adapter, and legacy-only tests.
  - [ ] Add replacement integration coverage through `NativeDeliveryService` for normal inbox and cold-session delivery.
  - [x] Remove recovery-specific provider classification; retain ordinary provider-unavailable reason/message detection.
- [ ] Remove or redesign direct lifecycle adapters used only to satisfy the legacy native injector contract.
- [ ] Resolve the daemon-runtime readonly SQLite test failure and rerun the complete runtime suite.
- [ ] Run the complete CLI test suite, typecheck, lint, and audit before declaring cleanup complete.

Next: complete the pre-cleanup audit, then remove compatibility adapters in small reviewable commits.
