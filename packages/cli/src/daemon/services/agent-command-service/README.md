# Agent Command Service

Daemon application boundary for durable agent commands.

- Coordinates stop commands against the existing agent-process service via the
  `AgentCommandProcessManager` port. It does not own PID, process, or slot state.
- Emits daemon `agent.stopped` facts through the `AgentFactSink` port.
- Does not write Convex directly.
- Machine-local scope is intentional: a chatroom target resolves only to active
  local roles on this machine.
- Owns the Convex inbox adapter, durable stopped-fact outbox, startup/shutdown
  lifecycle, and materialized transport state through the
  `DaemonAgentCommandService` façade.

## Public boundary

Other daemon components must use only `DaemonAgentCommandService`:

- `start()` starts inbox consumption;
- `stop()` drains in-flight commands and durable facts before closing transport;
- `getState()` returns the local, read-only materialized state;
- `subscribe()` observes state changes.

No caller outside this service's composition boundary may claim, acknowledge,
renew, or subscribe to the inbox, or append, flush, or stop the fact outbox.
The raw adapters and transport consumer are implementation details and must not
be passed through daemon entrypoints.

## Agent Command Inbox Consumer

`AgentCommandInboxConsumer` is transport-neutral. It owns serial
claim/process/ack behavior and lease renewal against the `AgentCommandInbox`
port:

- `completed` and `expired` results are acknowledged (terminal).
- `partial_failure` results and service/ack exceptions are reported through
  `onError` and left unacknowledged, so the command stays retryable after
  lease expiry. Stable fact event IDs keep retried targets idempotent.
- Processing is strictly serial; a nudge during a drain queues another drain
  instead of starting concurrent work.

The Convex inbox adapter and daemon startup composition are later slices.

## Composition

- `createDaemonAgentCommandService` adapts the existing agent-process service
  (listActive view mapping plus stop result mapping) into the command port and
  builds the application service. It holds no process or slot state itself.
- `createDaemonAgentCommandServiceRuntime` composes the Convex inbox, durable
  fact outbox, process manager, domain service, consumer, and materialized
  state behind the public façade.
- The daemon composition layer provides the façade as an Effect service. The
  operational inbox runtime only starts and stops that façade; it does not
  construct or close any transport adapter.
- The lower-level transport runtime remains available for focused unit tests,
  but is not a production integration point.
