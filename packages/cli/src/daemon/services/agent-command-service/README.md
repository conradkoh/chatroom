# Agent Command Service

Daemon application boundary for durable agent commands.

- Coordinates stop commands against the existing agent-process service via the
  `AgentCommandProcessManager` port. It does not own PID, process, or slot state.
- Emits daemon `agent.stopped` facts through the `AgentFactSink` port.
- Does not write Convex directly.
- Machine-local scope is intentional: a chatroom target resolves only to active
  local roles on this machine.
- Inbox adapter and durable outbox wiring are a later slice.
