# Command notifier

`command-notifier` is an in-process, SNS-like publisher for command execution
outcomes. It is separate from the command queue: the queue stores and orders
work, while the notifier broadcasts what happened after a consumer processes a
message.

```ts
import { createCommandNotifier } from './index.js';

const notifier = createCommandNotifier();

const unsubscribe = notifier.subscribe({ messageId: operationMessageId }, (event) => {
  if (event.status === 'succeeded') {
    console.log('Command completed');
  }
});

notifier.publish({
  eventId: crypto.randomUUID(),
  messageId: operationMessageId,
  messageGroupId: 'chatroom:role',
  body: command,
  status: 'succeeded',
  completedAt: Date.now(),
  receiveCount: 1,
});

unsubscribe();
```

Notifications are in-memory and are not retained. Listener errors are isolated
from the publisher and other listeners. Consumers should treat delivery as
at-least-once and deduplicate by `messageId` when retries are possible.
