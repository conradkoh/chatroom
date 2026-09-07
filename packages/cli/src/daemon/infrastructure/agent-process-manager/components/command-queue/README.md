# Command queue

The command queue is the low-level FIFO transport used by
`AgentProcessManagerService`. Application callers should use the service API;
use this component directly only when implementing or testing queue
infrastructure.

## Guarantees

- Messages are ordered within a `messageGroupId`.
- Different message groups may be processed concurrently.
- Receiving claims a temporary visibility lease; it does not delete a message.
- Successful processing must delete the message.
- Failed processing leaves the message available for retry after its lease
  expires.
- Delivery is at-least-once, so handlers must be idempotent.

## Construction

Create the queue at composition time and share it with its consumer:

```ts
import { createCommandQueue } from './index.js';

const queue = createCommandQueue();
```

The default implementation uses an in-memory store. A custom
`CommandQueueStore` can be supplied when a persistent strategy is needed.

## Writing and receiving messages

Writing stores a message but does not execute it:

```ts
await queue.sendMessage({
  messageGroupId: `${chatroomId}:${role.toLowerCase()}`,
  body: command,
  deduplicationId: commandId,
});
```

Receiving claims the next available message in each selected group:

```ts
const [message] = await queue.receiveMessages({
  maxNumberOfMessages: 1,
  visibilityTimeoutMs: 30_000,
});

if (message) {
  await dispatch(message.body);
  await queue.deleteMessage(message.receiptHandle);
}
```

Long-running handlers should renew the visibility lease:

```ts
await queue.changeMessageVisibility(message.receiptHandle, 60_000);
```

## Purging

`purge()` requires an explicit scope. Use `{ scope: 'all' }` for a full queue
purge, or use a message-group prefix to limit the purge:

```ts
await queue.purge({
  scope: 'message-group-prefix',
  messageGroupPrefix: `${chatroomId}:`,
});
```

The manager service uses a message-group prefix to purge either an entire
chatroom or one chatroom role during reset. Purging is not a substitute for
normal command processing and should only be used by reset coordination.

## Consumer

The service normally constructs and owns the consumer. For infrastructure
tests or another composition root, a consumer requires a queue, dispatcher,
notifier, and optional polling settings:

```ts
const consumer = new CommandQueueConsumer({
  queue,
  notifier,
  dispatch: async (message) => dispatch(message.body),
});

consumer.start();
await consumer.stop();
```

The consumer renews visibility while dispatching, publishes the execution
outcome, deletes successful messages, and leaves failed messages for retry.
