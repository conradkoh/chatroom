# Agent Process Manager Service

This folder contains the primary interface for consuming the agent process
manager. Callers should use `AgentProcessManagerService` instead of depending
directly on the concrete `AgentProcessManager` or the command queue.

## Lifecycle commands

The imperative lifecycle methods submit commands to the internal FIFO queue:

```ts
import { createCommandNotifier } from '../components/command-notifier/index.js';

const notifier = createCommandNotifier();

const service = createAgentProcessManagerService({
  execution: agentProcessManager,
  restartAgent: async ({ chatroomId, role }) => {
    // Delegate to the existing restart orchestration during migration.
    await restartExistingAgent({ chatroomId, role });
  },
  notifier,
});

const unsubscribe = service.subscribe({ messageGroupId: `${chatroomId}:${role}` }, (event) => {
  console.log(`Lifecycle command ${event.status}`);
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

These methods resolve after the consumer finishes processing the command. Use
`void service.stopAgent(...)` when the caller intentionally wants
fire-and-forget behavior. A failed lifecycle operation rejects the promise.

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
The notifier is constructed separately and injected explicitly. This keeps
notification delivery replaceable and makes it impossible to omit accidentally.

## Migration rule

New lifecycle callers should use this service. Existing flows can continue to
use the concrete manager temporarily while they are migrated behind the
service boundary.
