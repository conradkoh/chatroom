# Command notifier

The command notifier is an in-process publish/subscribe component for command
execution outcomes. It is separate from the command queue:

- The queue stores, orders, leases, and deletes work.
- The notifier broadcasts what happened after processing.
- The notifier does not retain events or execute commands.

## Construction

Create one notifier during daemon composition and inject it into the service:

```ts
import { createCommandNotifier } from './index.js';

const notifier = createCommandNotifier<AgentProcessManagerCommand>();
```

Most application callers should subscribe through
`AgentProcessManagerService.subscribe()` rather than using the notifier
directly.

## Subscribing

Subscriptions can filter by message, message group, or outcome status:

```ts
const unsubscribe = notifier.subscribe(
  { messageGroupId: `${chatroomId}:${role.toLowerCase()}` },
  (event) => {
    switch (event.status) {
      case 'succeeded':
        console.log('Command completed');
        break;
      case 'failed':
        console.error('Command failed', event.error);
        break;
      case 'cancelled':
        console.log('Command cancelled by reset');
        break;
    }
  }
);

unsubscribe();
```

Notifications are delivered only to active subscribers. Listener failures are
isolated from the publisher and other listeners. A listener must tolerate
duplicate outcomes when the surrounding queue processing can retry a message.
