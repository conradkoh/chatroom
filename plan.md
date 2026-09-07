# Agent lifecycle coordination plan

- [ ] Integrate the agent process manager command queue as the single entry point for serial execution of chatroom + role agent operations.
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
  - [ ] Route start, stop, restart, recovery, and legacy daemon flows through the queue.

## Next goal

- [x] Wire `AgentProcessManagerService` into daemon startup and shutdown.
- [ ] Migrate the first lifecycle flow.
  - [x] Expose `AgentProcessManagerService` through the runtime dependency graph.
  - [x] Migrate native cold-session stop/start sequencing as the pilot flow.
  - [x] Preserve completion-dependent follow-up work and failure handling.
  - [x] Verify same-key ordering for service operations and competing queued commands.
  - [x] Add focused tests for the migrated flow and timeout/cancellation behavior.
  - [x] Remove compatibility fallbacks and verify competing legacy-path behavior.
  - [ ] Migrate additional start, stop, restart, recovery, and shutdown callers.
  - [ ] Remove legacy direct lifecycle calls after each path is covered.

Next: gradually deprecate and remove the legacy lifecycle flows as each path is migrated.
