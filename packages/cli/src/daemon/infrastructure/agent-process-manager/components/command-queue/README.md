# Command queue

The command queue provides an SQS-like FIFO interface for daemon lifecycle
commands. Messages are ordered within a `messageGroupId`; messages in
different groups may be consumed concurrently.

## Construction

Create one queue instance at daemon composition time and share it with the
producers and consumer:

```ts
import { createCommandQueue } from './components/command-queue/index.js';

const commandQueue = createCommandQueue();
```

The constructor assembles the in-memory store and queue strategy. A custom
`CommandQueueStore` may be supplied for another storage strategy.

## Writing a command

Writing sends a message; it does not execute the command:

```ts
await commandQueue.sendMessage({
  messageGroupId: `chatroom:${chatroomId}`,
  body: {
    type: 'stop',
    chatroomId,
    role,
    pid,
  },
  deduplicationId: commandId,
});
```

Use the chatroom as the group for chatroom-wide lifecycle coordination. An
agent-specific group can be used when the command only affects one role:

```text
chatroom:{chatroomId}
agent:{chatroomId}:{role}
```

## Consuming a command

Receiving claims a message temporarily; it does not remove it:

```ts
const [message] = await commandQueue.receiveMessages({
  maxNumberOfMessages: 1,
  visibilityTimeoutMs: 30_000,
});

if (message) {
  try {
    await dispatchCommand(message.body);
    await commandQueue.deleteMessage(message.receiptHandle);
  } catch {
    // Leave it undeleted so it becomes visible for retry.
  }
}
```

Only one message from a `messageGroupId` can be in flight at a time. The next
message in that group becomes available after the current message is deleted
or its visibility timeout expires.

## Visibility and retries

Long-running commands can extend their lease:

```ts
await commandQueue.changeMessageVisibility(receiptHandle, 60_000);
```

If processing fails, do not delete the message. The queue will make it
available again after the visibility timeout. Processing is at-least-once;
command handlers must therefore be idempotent and validate the current PID and
lifecycle revision.

## Public operations

The use-case layer mirrors the queue protocol:

- `handle-send-command`
- `handle-receive-commands`
- `handle-delete-command`
- `handle-change-command-visibility`

The queue itself does not start or stop agents. A consumer dispatches the
received lifecycle command to the agent process manager.

## Consumer

Create one consumer for the daemon and inject the queue plus a lifecycle
dispatcher:

```ts
const consumer = new CommandQueueConsumer<LifecycleCommand>({
  queue: commandQueue,
  dispatch: async (message) => lifecycleDispatcher(message.body),
});

consumer.start();
```

The consumer processes messages from different groups concurrently, renews
visibility while a command is running, deletes successful messages, and leaves
failed messages undeleted for retry. Call `consumer.stop()` during daemon
shutdown.
