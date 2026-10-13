# Agent process service

This directory owns the daemon's agent lifecycle. The command API is documented in
[`service/README.md`](service/README.md). This file covers what the agent process manager publishes to the
rest of the daemon, and how it clears agents whose process has died.

Paths are relative to this directory, except paths that start with `packages/`, which are repo-root paths.

## Workspace presence

The manager publishes which agents run in which working directory. The workspace service uses this to decide
which workspaces are active.

- **`listWorkspacePresences()`** returns the present agents. It is derived from the slots on every call, with
  no cache. An agent is present when its slot is `spawning`, or when its slot is `running` or `stopping` and
  its pid is alive (`isAgentSlotPresent` in `packages/cli/src/daemon/domain/entities/agent-slot.ts`). A
  spawning slot has no pid yet, so it is present without one. A slot with no working directory is not
  reported.
- **`subscribeAgentPresenceChanged(handler)`** registers a handler and returns its unsubscribe function. The
  handler takes no payload. It fires after each slot transition that can change presence. Re-read
  `listWorkspacePresences()` for the current snapshot. A throwing handler is logged, and the other handlers
  and the caller are not affected.
- Running↔stopping transitions do not notify, because they do not change presence.

The rule that makes a directory active is stated once in the workspace service README
(`packages/cli/src/daemon/services/workspace-service/README.md`, Activity).

## Liveness sweep

A running agent whose process dies without an `onExit` callback would otherwise stay present, and its slot would
stay in its last state. The manager runs a periodic sweep to clear these.

- **`startLivenessSweep(intervalMs?)`** starts a timer that runs `reapDeadAgentProcesses` every
  `AGENT_LIVENESS_SWEEP_INTERVAL_MS` (10s). It is idempotent, and the timer is `unref`'d so it never keeps the
  daemon alive.
- **`stopLivenessSweep()`** clears the timer. It is idempotent.
- The daemon runtime owns the sweep. `startRuntimeEffect` in
  `packages/cli/src/daemon/entry/daemon-runtime.ts` starts it, and `stopWorkers` stops it. The manager's own
  `stop()` and `reset()` never start or stop it.

**`reapDeadAgentProcesses()`** runs one pass and then notifies presence once. It returns the number of slots
it reaped.

- A **running** slot whose pid is dead goes through `handleExit`, so the reap matches a real exit: the slot
  resets, the `exited` fact is enqueued, and the pid is cleared.
- A **stopping** slot whose pid is dead is cleared through `forceClearStuckStoppingSlot` with stop reason
  `daemon.stop_timeout`, once it has been stopping for `STOPPING_TIMEOUT_MS` (30s). This is the path for a
  stop whose harness call never resolves. Until the timeout elapses, the slot is left alone.
- A **live** slot is never touched, at any age. A **spawning** slot has no pid, so the sweep skips it.
- A sweep with nothing to reap makes no writes.

Each reap is isolated. A failure is logged, and the sweep continues.

## The exited fact

Each agent exit produces exactly one backend `exited` lifecycle fact. Two paths can produce it, and each path
only emits while the slot still holds the pid. `forceClearStuckStoppingSlot` clears `slot.pid` before its first
`await`. A stop that resolves after that point sees the cleared pid, and its late fact is dropped
(`doStop`, the `lifecycleOutbox` gate). A stop that resolves after a newer run has started drops its fact the same
way, because the pid differs.

## Known limits

- **Stuck window.** A dead agent whose stop hangs can stay `stopping`, and show as online, for up to
  `STOPPING_TIMEOUT_MS` plus one sweep interval, about 40s at the default values.
- **Duplicate local audit.** A dropped late stop still writes a local `agent.exited` audit event. The adapter
  writes that audit before it enqueues the fact (`infrastructure/stop-agent-confirmed-adapter.ts`, `enqueueExitedFact`). The backend
  receives exactly one fact, but the local log can show two `agent.exited` events for one agent.
- **Stop promise.** The promise returned by `stop()` settles only when the harness call settles. When the
  sweep clears a hung stop, the slot and presence update, but that promise can stay pending until the harness
  call returns.
