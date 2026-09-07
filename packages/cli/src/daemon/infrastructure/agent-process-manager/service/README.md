# Agent Process Manager Service

This folder contains the primary interface for consuming the agent process
manager. Callers should use `AgentProcessManagerService` instead of depending
directly on the concrete `AgentProcessManager` or the command queue.

## Lifecycle commands

The imperative lifecycle methods submit commands to the internal FIFO queue:

```ts
const service = createAgentProcessManagerService({
  execution: agentProcessManager,
  restartAgent: async ({ chatroomId, role }) => {
    // Delegate to the existing restart orchestration during migration.
    await restartExistingAgent({ chatroomId, role });
  },
});

await service.startAgent({
  chatroomId,
  role,
  agentHarness,
  workingDir,
  reason: 'user.start',
  wantResume: false,
});

await service.stopAgent({
  chatroomId,
  role,
  reason: 'user.stop',
});
```

These methods resolve when the command is accepted by the queue. They do not
wait for process execution to finish. The returned message contains the queue
`messageId`, which can later support operation status or completion tracking.

Commands for the same `chatroomId` and `role` share a FIFO message group and
are processed serially. Commands for different agents may be processed in
parallel.

## Starting the consumer

The daemon owns the consumer lifecycle:

```ts
service.startProcessing();

try {
  await runDaemon();
} finally {
  service.stopProcessing();
}
```

The service constructor currently assembles the in-memory queue and consumer.
That is the composition point for replacing the queue store or adding durable
completion tracking later.

## Migration rule

New lifecycle callers should use this service. Existing flows can continue to
use the concrete manager temporarily while they are migrated behind the
service boundary.
