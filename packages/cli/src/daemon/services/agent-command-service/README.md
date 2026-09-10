# Agent Command Service

Daemon application boundary for durable agent commands.

- Coordinates stop commands against the existing agent-process service via the
  `AgentCommandProcessManager` port. It does not own PID, process, or slot state.
- Emits daemon `agent.stopped` facts through the `AgentFactSink` port.
- Does not write Convex directly.
- Machine-local scope is intentional: a chatroom target resolves only to active
  local roles on this machine.
- Inbox adapter and durable outbox wiring are a later slice.

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
- `startDaemonAgentCommandRuntime` composes inbox, process manager, service,
  and fact sink into a running transport-neutral consumer, returning the
  consumer stop handle.
- Resource ownership remains with the caller: the runtime creates only the
  composed service and consumer. It does not create or close the inbox, fact
  sink, or process manager.

Convex adapter and daemon startup wiring are intentionally later slices.
