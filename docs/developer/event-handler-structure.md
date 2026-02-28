# Event Handler Structure

Reference guide for organizing event handler code across the monorepo.

---

## Overview

Event handlers react to things that have already happened — an agent crashed, a task was activated, a command was dispatched. They are distinct from:

- **Command handlers** — process backend-dispatched commands (start-agent, stop-agent, ping)
- **Use cases** — orchestrate multi-step domain operations
- **Convex mutations/queries** — expose public or internal API surfaces

Separating event handlers into a dedicated `src/events/` tree provides three benefits:

1. **Discoverability** — all event reactions are in one place, not scattered across handlers and mutations
2. **Separation of concerns** — command processing logic stays clean; event side effects are isolated
3. **Extensibility** — adding a new reaction to an existing event means adding one file, not modifying existing handlers

---

## General Convention

```
src/events/<namespace>/<event-name>.ts
```

| Part         | Description                                                       | Example                |
| ------------ | ----------------------------------------------------------------- | ---------------------- |
| `namespace`  | Domain area the event belongs to                                  | `agent`, `task`        |
| `event-name` | Kebab-case name, prefixed with `on-` and describing what happened | `on-agent-exited`      |

Each file exports a **single handler function** named `on<EventName>` in PascalCase:

```ts
// src/events/agent/on-agent-exited.ts
export async function onAgentExited(ctx, args) {
  // ...
}
```

---

## Backend (`services/backend/src/events/`)

Backend event handlers contain domain logic that reacts to events written to `chatroom_eventStream`. They are called from Convex internal mutations (e.g. `recordAgentExited`) — the mutation writes the event and invokes the handler.

**Target structure:**

```
src/events/
  agent/
    on-agent-exited.ts      # handles agent.exited events (crash recovery scheduling)
    on-agent-started.ts     # (future) handles agent.started events
  task/
    on-task-activated.ts    # (future) handles task.activated events
    on-task-completed.ts    # (future) handles task.completed events
```

> **Note:** Convex handler declarations (internal mutations, actions, scheduled functions) stay in `convex/`. Only the domain reaction logic moves to `src/events/`.

---

## CLI (`packages/cli/src/events/`)

The CLI daemon has two distinct event contexts, each with its own subdirectory:

### `daemon/` — in-process typed events

Handlers for `DaemonEventBus` events. These are typed, synchronous-ish events emitted within the daemon process (e.g. when an agent process exits or starts).

### `lifecycle/` — OS-level process lifecycle events

Handlers for SIGTERM, process exit, and other OS-level signals. These are typically invoked by the daemon's signal handlers, not the event bus.

**Target structure:**

```
src/events/
  daemon/
    event-bus.ts                  # DaemonEventBus class definition
    register-listeners.ts         # registers all daemon event handlers
    agent/
      on-agent-exited.ts          # handles agent:exited DaemonEvent
      on-agent-started.ts         # handles agent:started DaemonEvent
      on-agent-stopped.ts         # handles agent:stopped DaemonEvent
    command/
      on-command-processing.ts    # handles command:processing DaemonEvent
      on-command-completed.ts     # handles command:completed DaemonEvent
  lifecycle/
    on-agent-shutdown.ts          # handles OS-level agent process shutdown
    on-daemon-shutdown.ts         # handles OS-level daemon shutdown (SIGTERM etc.)
```

---

## Frontend (`apps/webapp/src/events/`)

Currently empty. Event handlers in the frontend live inline in components and hooks. This directory is reserved for future extraction if event handler logic becomes complex enough to warrant separation.

---

## Rules for Adding New Event Handlers

1. **Create a new file** in the appropriate namespace directory
2. **Export a single function** named `on<EventName>` (e.g. `onAgentExited`, `onTaskCompleted`)
3. **Add a JSDoc comment** explaining which event it handles and what it does
4. **Keep it focused** — one file per event type; no shared state between handlers
5. **Best-effort errors** — wrap external calls in try/catch; log warnings but don't throw

```ts
/**
 * Handles the `agent.exited` event.
 *
 * Schedules an immediate ensure-agent check when the exit is unintentional,
 * so crash recovery fires without waiting for the 120s scheduled timer.
 */
export async function onAgentExited(ctx: MutationCtx, args: AgentExitedArgs): Promise<void> {
  if (!args.intentional) {
    // ... schedule ensure-agent check
  }
}
```

---

## What Does NOT Go in `src/events/`

| What                    | Where it lives                                         | Why                                           |
| ----------------------- | ------------------------------------------------------ | --------------------------------------------- |
| Command handlers        | `daemon-start/handlers/start-agent.ts`                 | Processes backend-dispatched commands, not events |
| Convex mutations/queries | `convex/`                                             | Public/internal API surface declarations      |
| Use cases               | `src/domain/usecase/`                                  | Multi-step orchestration, not event reactions |
| DaemonEventBus class    | `src/events/daemon/event-bus.ts`                       | Infrastructure shared by all daemon handlers  |
