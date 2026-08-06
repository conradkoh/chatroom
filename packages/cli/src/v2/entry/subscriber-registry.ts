import { routeInboundEvent, type EventRouterDeps } from './event-router.js';
import type { InboundEvent } from '../domain/entities/inbound-event.js';
import type { ConvexSubscriberDeps } from '../infrastructure/convex/subscriber-deps.js';
import { startAssignedTaskPresenceSubscriber } from '../infrastructure/convex/subscribers/assigned-task-presence.js';
import { startAssignedTaskSignalsSubscriber } from '../infrastructure/convex/subscribers/assigned-task-signals.js';
import { startDirectHarnessCommandSubscriber } from '../infrastructure/convex/subscribers/direct-harness-command.js';
import { startDirectHarnessPromptSubscriber } from '../infrastructure/convex/subscribers/direct-harness-prompt.js';
import { startDirectHarnessSessionSubscriber } from '../infrastructure/convex/subscribers/direct-harness-session.js';

export type SubscriberRegistryDeps = ConvexSubscriberDeps & {
  router: EventRouterDeps;
};

export type SubscriberRegistryHandle = { stopAll(): Promise<void> };

export function startAllSubscribers(deps: SubscriberRegistryDeps): SubscriberRegistryHandle {
  const onEvent = (event: InboundEvent): void => {
    void routeInboundEvent(deps.router, event);
  };

  const signals = startAssignedTaskSignalsSubscriber(deps, onEvent);
  const presence = startAssignedTaskPresenceSubscriber(deps, onEvent);
  const session = startDirectHarnessSessionSubscriber(deps, onEvent);
  const prompt = startDirectHarnessPromptSubscriber(deps, onEvent);
  const command = startDirectHarnessCommandSubscriber(deps, onEvent);

  return {
    async stopAll() {
      await Promise.all([
        signals.stop(),
        presence.stop(),
        session.stop(),
        prompt.stop(),
        command.stop(),
      ]);
    },
  };
}
