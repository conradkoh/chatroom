# Agent Process Manager Service

`AgentProcessManagerService` is the application-facing API for controlling
agents. Callers should depend on this interface rather than on
`AgentProcessManager`, `CommandQueue`, or `CommandQueueConsumer` directly.

The service owns command submission, per-agent FIFO ordering, command
completion, notifications, and reset coordination.

## Composition

Construct one service during daemon initialization. The concrete manager is
provided as the execution port, and the notifier is provided separately:

```ts
import { createCommandNotifier } from '../components/command-notifier/index.js';
import { createAgentProcessManagerService } from './index.js';

const notifier = createCommandNotifier<AgentProcessManagerCommand>();

const service = createAgentProcessManagerService({
  execution: agentProcessManager,
  notifier,
  restartAgent: async (input) => {
    await restartExistingAgent(input);
  },
});
```

The daemon starts and stops processing once for the lifetime of the service:

```ts
service.startProcessing();

try {
  await runDaemon();
} finally {
  await service.stopProcessing();
}
```

Do not create a service per request or start a separate consumer for each
caller.

## Lifecycle commands

Use the imperative methods to request lifecycle work:

```ts
const completion = await service.stopAgent({
  chatroomId,
  role,
  reason: 'user.stop',
});
```

`startAgent`, `stopAgent`, and `restartAgent` resolve after the command has
finished executing. The resolved value is a `CommandNotification` with a
`succeeded` status. Failed execution rejects the promise with the command
failure. Use `void` only when the caller intentionally wants fire-and-forget
behavior:

```ts
void service.stopAgent({ chatroomId, role, reason: 'user.stop' });
```

Commands for the same chatroom and role are serialized. Commands for different
roles may execute concurrently.

## Notifications

Subscribe when a caller needs an event-driven completion signal or needs to
observe commands issued by other callers:

```ts
const unsubscribe = service.subscribe(
  { messageGroupId: `${chatroomId}:${role.toLowerCase()}` },
  (notification) => {
    if (notification.status === 'succeeded') {
      console.log('Agent command completed');
    } else if (notification.status === 'failed') {
      console.error('Agent command failed', notification.error);
    } else {
      console.log('Agent command was cancelled');
    }
  }
);

unsubscribe();
```

Notifications are in-memory and are not replayed to late subscribers. A
command caller should await the returned promise when it owns the command;
subscriptions are for decoupled observation.

## Resetting state

Reset is a control-plane operation, not a queued lifecycle command. It stops
polling, allows an already-dispatched command to settle, stops and clears the
selected manager state, purges queued commands in the selected scope, and
publishes `cancelled` notifications for purged commands. Processing resumes if
it was running before the reset.

Reset an entire chatroom:

```ts
const result = await service.reset({
  scope: 'chatroom',
  chatroomId,
});
```

Reset one role without affecting other roles in the chatroom:

```ts
const result = await service.reset({
  scope: 'chatroom-role',
  chatroomId,
  role,
});
```

Awaiters for purged commands receive a cancellation rejection. Calls made
after reset begins are rejected until reset completes. Other chatrooms retain
their queued commands and state.

## Migration guidance

New lifecycle callers must use this service. Existing direct manager callers
should be migrated incrementally behind this boundary. The queue and notifier
are implementation components, not alternate lifecycle entry points.
