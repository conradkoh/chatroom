import { routeInboundEvent, type EventRouterDeps } from './event-router.js';
import type { InboundEvent } from '../domain/entities/inbound-event.js';
import type { ConvexSubscriberDeps } from '../infrastructure/convex/subscriber-deps.js';
import { startAgenticQueryPromptSubscriber } from '../infrastructure/convex/subscribers/agentic-query-prompt.js';
import { startAgenticQuerySessionSubscriber } from '../infrastructure/convex/subscribers/agentic-query-session.js';
import { startAssignedTaskPresenceSubscriber } from '../infrastructure/convex/subscribers/assigned-task-presence.js';
import { startAssignedTaskSignalsSubscriber } from '../infrastructure/convex/subscribers/assigned-task-signals.js';
import { startCommandEventsSubscriber } from '../infrastructure/convex/subscribers/command-events.js';
import { startCommandRunSubscriber } from '../infrastructure/convex/subscribers/command-run.js';
import { startDirectHarnessCommandSubscriber } from '../infrastructure/convex/subscribers/direct-harness-command.js';
import { startDirectHarnessPromptSubscriber } from '../infrastructure/convex/subscribers/direct-harness-prompt.js';
import { startDirectHarnessSessionSubscriber } from '../infrastructure/convex/subscribers/direct-harness-session.js';
import { startEnhancerJobSubscriber } from '../infrastructure/convex/subscribers/enhancer-job.js';
import { startFileContentRequestSubscriber } from '../infrastructure/convex/subscribers/file-content-request.js';
import { startFileTreeRequestSubscriber } from '../infrastructure/convex/subscribers/file-tree-request.js';
import { startFileWriteRequestSubscriber } from '../infrastructure/convex/subscribers/file-write-request.js';
import { startGitRequestSubscriber } from '../infrastructure/convex/subscribers/git-request.js';
import { startUserMessageSubscriber } from '../infrastructure/convex/subscribers/user-message.js';
import { startWorkspaceListSubscriber } from '../infrastructure/convex/subscribers/workspace-list.js';
import { startInboundSubscribers } from '../infrastructure/inbound/convex/subscriber-registry.js';

export type SubscriberRegistryDeps = ConvexSubscriberDeps & {
  router: EventRouterDeps;
};

export type SubscriberRegistryHandle = { stopAll(): Promise<void> };

export function startAllSubscribers(deps: SubscriberRegistryDeps): SubscriberRegistryHandle {
  const onEvent = (event: InboundEvent): Promise<void> => routeInboundEvent(deps.router, event);

  return startInboundSubscribers(deps, onEvent);
}
