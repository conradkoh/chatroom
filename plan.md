# Harness turn-completion reliability plan

## Objective

Unify the daemon's handling of agent turns without pretending that provider
signals are identical.

The implementation must guarantee:

```text
one logical turn → one terminal outcome → one daemon reconciliation pass
```

Provider-specific events remain inside harness adapters. The daemon consumes a
typed, exactly-once `TurnResult` and separately tracks process/session exit.

## Shared model to validate first

Every harness must be mapped onto this workflow:

```text
beginTurn(turnId)
  → activity/progress events
  → provider terminal observation
  → exactly-once TurnResult
  → lifecycle publication
  → task/agent reconciliation
```

Proposed terminal result:

```ts
type TurnResult = {
  turnId: string;
  status: 'completed' | 'failed' | 'aborted' | 'timed_out' | 'process_exited';
  source: string;
  providerTurnId?: string;
  error?: string;
};
```

The following are separate concerns and must not be conflated:

- A provider turn completed.
- A transport stream or iterator ended.
- A session became idle.
- A prompt promise resolved.
- A keeper or child process exited.
- A compatibility `agent_end` log line was written.

## Shared constraints for every implementation

- [ ] Each logical turn has a unique daemon `turnId`.
- [ ] Each turn has exactly one terminal `TurnResult`.
- [ ] Duplicate provider terminal events are harmless and do not publish twice.
- [ ] Stream/iterator completion is not treated as successful completion unless the
      adapter has already observed a successful provider terminal state.
- [ ] Timeout produces `timed_out`, never `completed`.
- [ ] Process exit before a terminal turn result produces `process_exited`.
- [ ] Provider failure produces `failed`, even if the transport closes cleanly.
- [ ] Turn completion and process/session exit remain separate lifecycle events.
- [ ] Activity events cannot complete a turn.
- [ ] Compatibility `agent_end` output is derived from the finalized result and cannot
      independently drive lifecycle state.
- [ ] A long-lived native session can complete multiple turns without a sticky latch
      suppressing later completions.
- [ ] Late callback registration cannot lose an already-observed terminal result.
- [ ] Completion is correlated to the correct harness session and turn.
- [ ] Post-turn task delivery runs only after the turn coordinator has finalized the
      result and released the process-manager serialization boundary.
- [ ] A failed, timed-out, aborted, or process-exited turn cannot be interpreted as a
      successful task completion.
- [ ] Cancellation and daemon shutdown are idempotent and do not create a second result.

## Assessments required for each harness

For every harness, complete the assessment below and record the answers next to its
adapter/service tests.

### Assessment template

- [ ] What is the provider's authoritative successful terminal signal?
- [ ] What is the provider's authoritative failure signal?
- [ ] What does the provider's stream/iterator/prompt promise mean when it resolves?
- [ ] Can the provider emit terminal events more than once for one turn?
- [ ] Can terminal events arrive after the stream or prompt promise resolves?
- [ ] Can activity arrive after the apparent terminal event?
- [ ] How is a provider turn identified and correlated to `turnId`?
- [ ] How is a second turn armed on the same session?
- [ ] What happens if the process exits while a turn is active?
- [ ] What happens if the provider hangs and the timeout expires?
- [ ] Can the session be resumed after failure or process exit?
- [ ] Which event should be visible as `lifecycle.turn.completed`, if any?
- [ ] Which existing logs or callbacks must be converted to derived observability only?
- [ ] Which unit, integration, and restart tests prove the answers?

### `claude-sdk`

Implementation references:

- `packages/cli/src/daemon/infrastructure/local/harness/adapters/claude-sdk/`
- `packages/cli/src/daemon/infrastructure/local/harness/services/claude-sdk/`

Assessment questions:

- [ ] Confirm whether a successful `result` message is the only success authority.
- [ ] Confirm whether `result.is_error` and thrown query errors always become `failed`.
- [ ] Confirm whether breaking the `for await` loop after `result` loses any required
      final provider state.
- [ ] Confirm whether `query()` resolving without a `result` is a transport failure or
      an incomplete/unknown turn.
- [ ] Confirm provider session-ID allocation and rotation boundaries across resumes.
- [ ] Confirm interruption behavior when the query is cancelled or the keeper exits.

Constraints:

- [ ] `result` must be classified before any iterator-completion fallback.
- [ ] `result.is_error` must never emit a successful `TurnResult`.
- [ ] Query timeout or interruption must produce `timed_out` or `aborted`, not idle.
- [ ] The per-query adapter must not emit a second completion from `finally`.
- [ ] Resume must create a fresh per-turn completion scope while preserving the provider
      session ID.

### `codex-sdk`

Implementation references:

- `packages/cli/src/daemon/infrastructure/local/harness/services/codex-sdk/`

Assessment questions:

- [ ] Confirm that `turn.completed` is authoritative success and contains enough identity
      to correlate the active turn.
- [ ] Confirm that `turn.failed` and top-level `error` are authoritative failures.
- [ ] Determine whether the `runStreamed()` iterator can end without either terminal
      event.
- [ ] Determine whether a failed turn can be followed by another turn on the same thread.
- [ ] Confirm whether stream cleanup can race with `turn.completed` handling.

Constraints:

- [ ] `turn.completed` and `turn.failed` must be mutually exclusive terminal outcomes.
- [ ] Iterator completion alone must not imply success.
- [ ] A top-level stream error must resolve the active turn as `failed` or `process_exited`.
- [ ] `finish()` may flush output, but may not upgrade an unknown/failed turn to success.
- [ ] A new `runStreamed()` call must create a new turn scope and reset completion state.

### `cursor-sdk`

Implementation references:

- `packages/cli/src/daemon/infrastructure/local/harness/adapters/cursor-sdk/`
- `packages/cli/src/daemon/infrastructure/local/harness/services/cursor-sdk/`

Assessment questions:

- [ ] Confirm whether `run.wait()` is authoritative for both success and failure.
- [ ] Determine whether `run.stream()` can end before `run.wait()` settles.
- [ ] Determine whether `run.wait()` can resolve with an error status after partial output.
- [ ] Confirm behavior when the run is aborted while streaming.
- [ ] Confirm whether each `agent.send()` has a stable provider run ID.
- [ ] Confirm the lifecycle of the lightweight keeper child relative to the SDK run.

Constraints:

- [ ] `run.wait()` result must be translated into an explicit `TurnResult`.
- [ ] Stream exhaustion must not independently emit completion.
- [ ] Error-status runs must never emit successful completion.
- [ ] Aborted runs must be distinguishable from provider failures.
- [ ] The keeper's process exit must not be mistaken for normal run completion.
- [ ] Multiple sequential `agent.send()` calls must have independent completion gates.

### `opencode-sdk`

Implementation references:

- `packages/cli/src/daemon/infrastructure/local/harness/adapters/opencode-sdk/`
- `packages/cli/src/daemon/infrastructure/local/harness/services/opencode-sdk/`

Assessment questions:

- [ ] Confirm whether `session.idle` is authoritative only after a prompt has been
      submitted and the turn has been armed.
- [ ] Determine whether `session.status: idle` and `session.idle` can both arrive for one
      turn, and which one wins.
- [ ] Determine whether any content or tool events can arrive after idle.
- [ ] Determine how the SSE fan-out identifies the target session and turn.
- [ ] Determine whether `promptAsync()` returning 204 means only accepted/submitted.
- [ ] Define the correct result of the idle timeout; it must not be synthetic success.
- [ ] Define how a provider error, server exit, SSE disconnect, and prompt rejection differ.
- [ ] Confirm re-arming behavior for consecutive turns on the same session.

Constraints:

- [ ] `promptAsync()` response must never complete the turn.
- [ ] An idle event must be accepted only for an armed, active turn.
- [ ] Duplicate idle/status-idle events must resolve once.
- [ ] Events for another session must be ignored for the active turn.
- [ ] No timeout path may emit a synthetic successful `session.idle`.
- [ ] Idle timeout must produce `timed_out` and initiate an explicit recovery policy.
- [ ] SSE disconnect and server/process exit must produce a non-success outcome when a
      turn is active.
- [ ] Events arriving after terminal resolution must be retained only for diagnostics,
      never for task lifecycle transitions.

### `pi-sdk`

Implementation references:

- `packages/cli/src/daemon/infrastructure/local/harness/adapters/pi-sdk/`
- `packages/cli/src/daemon/infrastructure/local/harness/services/pi-sdk/`

Assessment questions:

- [ ] Confirm whether the SDK's `agent_end` event is authoritative success/failure or
      merely the end of the current prompt call.
- [ ] Determine whether `session.prompt()` resolves before, after, or concurrently with
      `agent_end`.
- [ ] Determine whether the SDK emits a failure event distinct from `agent_end`.
- [ ] Confirm subscription setup and teardown for every prompt.
- [ ] Confirm whether events can arrive after `prompt()` resolves.
- [ ] Confirm whether the session can safely handle sequential prompts after an error.

Constraints:

- [ ] Choose exactly one authority between provider `agent_end` and `session.prompt()`;
      the other becomes transport cleanup or a consistency check.
- [ ] The chosen authority must carry or inherit the active `turnId`.
- [ ] Duplicate provider-end plus `finish()` paths must resolve once.
- [ ] Prompt timeout, abort, and session disposal must produce explicit non-success
      outcomes.
- [ ] Per-prompt subscriptions must not leak events into the next turn.
- [ ] A late `agent_end` from the previous prompt must not complete the next prompt.

## Cross-cutting implementation milestones

### Milestone 1 — Capture current behavior

- [ ] Build a completion matrix for all five SDK integrations using the assessment
      template above.
- [ ] Trace every path that currently calls `finish()`, `onAgentEnd`, emits `agent_end`,
      emits `session.idle`, or maps to `lifecycle.turn.completed`.
- [ ] Add temporary structured diagnostics containing harness, session ID, turn ID,
      provider event, adapter state, and terminal decision.
- [ ] Reproduce duplicate completion, missed completion, timeout, and process-exit cases
      in focused tests before changing behavior.

### Milestone 2 — Introduce the turn outcome boundary

- [ ] Add `TurnResult`, terminal status, terminal source, and `turnId` types.
- [ ] Add an exactly-once turn coordinator/latch owned by the daemon, not by provider
      stream adapters.
- [ ] Make late terminal callbacks observe the already-finalized result.
- [ ] Separate turn completion from process exit in the lifecycle event model.
- [ ] Keep a compatibility bridge for existing `onAgentEnd` consumers while migration is
      in progress.

### Milestone 3 — Migrate adapters one at a time

- [ ] Migrate Claude SDK first because its `result` boundary is comparatively direct.
- [ ] Migrate Codex SDK and remove iterator-completion success fallback.
- [ ] Migrate Cursor and make `run.wait()` the explicit run outcome boundary.
- [ ] Migrate Pi after deciding whether prompt resolution or provider `agent_end` wins.
- [ ] Migrate OpenCode last, replacing timeout-to-idle behavior with typed timeout and
      recovery handling.
- [ ] For each migration, preserve existing logs while changing lifecycle authority.

### Milestone 4 — Rework daemon reconciliation

- [ ] Publish `lifecycle.turn.completed` only from a successful finalized turn result.
- [ ] Publish explicit failure/timeout/abort/process-exit facts for non-success results.
- [ ] Ensure task delivery after a turn occurs only once and only after reconciliation.
- [ ] Ensure process exit releases or recovers the active task without claiming success.
- [ ] Remove lifecycle transitions driven directly by compatibility log parsing.
- [ ] Review enhancer salvage behavior so it uses typed turn outcomes plus backend job
      state, rather than treating every `agent_end` as equivalent.

### Milestone 5 — Verify recovery and observability

- [ ] Add contract tests that run the same turn scenario against every harness adapter.
- [ ] Test duplicate terminal signals, terminal-before-callback-registration, terminal
      plus process exit races, timeout followed by late idle, and activity after terminal.
- [ ] Test two sequential turns on one long-lived session.
- [ ] Test daemon restart during an active turn and after provider session allocation.
- [ ] Assert one and only one `TurnResult` per turn.
- [ ] Assert that only successful results trigger normal next-task delivery.
- [ ] Assert that timeout/failure/process-exit paths are visible and recoverable.
- [ ] Update `docs/application/harnesss/discovery.md` after behavior stabilizes.

## Definition of done

- [ ] Every SDK harness has a documented authoritative terminal signal and non-success
      behavior.
- [ ] No provider adapter treats transport completion as success without provider
      evidence.
- [ ] No timeout emits a synthetic successful completion signal.
- [ ] No logical turn produces duplicate lifecycle completion.
- [ ] No logical turn can remain indefinitely unresolved without a timeout or process-exit
      outcome.
- [ ] A long-lived native session completes multiple turns correctly.
- [ ] Task delivery, enhancer completion, and agent status all consume the same finalized
      turn outcome.
- [ ] Existing CLI-only harness behavior remains unchanged unless explicitly migrated.
- [ ] Unit, integration, restart/recovery, typecheck, lint, and formatting checks pass.
