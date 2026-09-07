# Agent lifecycle coordination plan

- [x] Integrate the agent process manager command queue as the single entry point for serial execution of chatroom + role agent operations.
  - [x] Define FIFO command messages and lifecycle command entities.
  - [x] Implement per-group ordering, receipt handles, visibility timeouts, retries, and deduplication support.
  - [x] Add the in-memory command-queue store strategy and component constructor.
  - [x] Add send, receive, delete, and visibility-change use cases.
  - [x] Add the dedicated queue consumer and command dispatcher.
  - [x] Add the `AgentProcessManagerService` interface and queue-backed adapter.
  - [x] Add imperative start, stop, restart, and recovery command submission.
  - [x] Add the in-process command completion notifier and filtered subscriptions.
  - [x] Make notifier dependencies mandatory and add serialization/completion tests.
  - [x] Add cancellable, timeout-bounded compound operations for one agent key.
  - [x] Route start, stop, restart, recovery, and legacy daemon flows through the queue.

## Next goal

- [x] Wire `AgentProcessManagerService` into daemon startup and shutdown.
- [ ] Migrate the first lifecycle flow.
  - [x] Expose `AgentProcessManagerService` through the runtime dependency graph.
  - [x] Migrate native cold-session stop/start sequencing as the pilot flow.
  - [x] Preserve completion-dependent follow-up work and failure handling.
  - [x] Verify same-key ordering for service operations and competing queued commands.
  - [x] Add focused tests for the migrated flow and timeout/cancellation behavior.
  - [x] Remove compatibility fallbacks and verify competing legacy-path behavior.
  - [x] Migrate native pending-task wake and revive start operations through serialized coordination.
  - [x] Migrate `agent.requestStart` through the queue-backed process manager service.
  - [x] Migrate restart stop/start orchestration through one serialized agent operation.
  - [x] Coordinate role-scoped stop target execution through the process manager service.
  - [x] Coordinate chatroom-scoped exact-target stops per agent key.
  - [x] Migrate recovery and shutdown lifecycle calls to the queue-backed service.
  - [x] Migrate canonical task-orchestration wake/revive recovery starts.
  - [x] Migrate the remaining active start, stop, restart, recovery, and shutdown callers.
  - [x] Verify remaining direct manager references are limited to compatibility adapters and the
        process-manager implementation, with active lifecycle entry points using the queue-backed service.

## Pre-cleanup audit

- [x] Inventory every remaining agent lifecycle caller and classify it as migrated, internal, or compatibility-only.
  - [x] Search UI, command-inbox, event-listener, task-delivery, restart, recovery, shutdown, and enhancer flows.
  - [x] Confirm active production entry points use the queue-backed service or serialized capability.
  - [ ] Decide whether manager-internal restart/crash handling is intentionally below the service boundary.
  - [ ] Audit manager-internal `maybeRestartAgent` and resume-storm stop calls for races with queued commands.
- [ ] Verify every service dependency is mandatory in production wiring.
  - [ ] Remove optional `processManagerService` dependencies and inline serialized-operation fallbacks in daemon services.
  - [ ] Make task-inbox delivery and native task-delivery coordinator serialization dependencies mandatory.
  - [ ] Confirm daemon initialization starts the queue consumer before recovery commands can be awaited.
- [x] Define and verify completion semantics for every migrated caller.
  - [x] Confirm callers that require ordering await service promises.
  - [x] Confirm intentional fire-and-forget callers handle rejection or subscribe to notifications.
  - [ ] Confirm operation timeouts and cancellation signals are present for every compound operation, including internal recovery paths.
- [x] Audit per-key coverage for multi-agent operations.
  - [x] Verify chatroom-scoped stops serialize independently per role.
  - [x] Verify UI start, stop, and restart actions use the same service boundary.
  - [x] Verify native delivery, recovery, and restart flows use the per-agent key.
- [ ] Audit secondary lifecycle-triggering use cases that were not part of the first migration.
  - [ ] Route resume-storm abort stops through the service or document why manager ownership makes direct execution safe.
  - [ ] Audit automatic crash/exit restart paths for coordination with queued start/stop/restart commands.
  - [ ] Review enhancer/native harness stop paths and classify them as agent lifecycle or child-process cleanup.
- [ ] Audit all optional compatibility paths.
  - [ ] Remove `task-inbox-delivery` registry fallback after its required service dependency is wired everywhere.
  - [ ] Remove `native-task-delivery-coordinator` registry fallback after its required service dependency is wired everywhere.
  - [ ] Make the service restart executor dependency mandatory once restart orchestration is fully owned by the service.
- [ ] Add regression coverage for competing start/stop/restart/recovery commands from each entry path.
- [ ] Update READMEs and discovery documentation to reflect the final service boundary and migration status.

## Cleanup

- [ ] Remove the unused `EnsureRunningResult` type from the start use case.
- [ ] Remove the unused restart session-wait PID parameter.
- [ ] Remove `NativeInjectorAgentMgr.stop()` and `.ensureRunning()` after all injector callers use serialized operations.
- [ ] Remove obsolete lifecycle adapter properties from restart, native delivery, and task orchestration wiring.
- [ ] Replace the empty-target stop fallback with `processManagerService.stopAgent()`.
- [ ] Make `processManagerService` mandatory in `DaemonAgentProcessManagerServiceLive`.
- [ ] Remove inline no-op serialized-operation fallbacks from scoped stop wiring.
- [ ] Extract shared lifecycle timeout values into named constants.
- [ ] Remove legacy lifecycle methods from the Effect manager boundary once downstream consumers are migrated.
- [ ] Remove transitional tests, casts, and compatibility-only test fixtures.
- [ ] Remove or redesign direct lifecycle adapters used only to satisfy the legacy native injector contract.
- [ ] Resolve the daemon-runtime readonly SQLite test failure and rerun the complete runtime suite.
- [ ] Run the complete CLI test suite, typecheck, lint, and audit before declaring cleanup complete.

Next: complete the pre-cleanup audit, then remove compatibility adapters in small reviewable commits.
