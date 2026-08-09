import { routeInboundEvent, type EventRouterDeps } from './event-router.js';
import type { InboundEvent } from '../domain/entities/inbound-event.js';
import type { ConvexSubscriberDeps } from '../infrastructure/convex/subscriber-deps.js';
import { startAgenticQueryPromptSubscriber } from '../infrastructure/convex/subscribers/agentic-query-prompt.js';
import { startAgenticQuerySessionSubscriber } from '../infrastructure/convex/subscribers/agentic-query-session.js';
import { startAssignedTaskPresenceSubscriber } from '../infrastructure/convex/subscribers/assigned-task-presence.js';
import { startAssignedTaskSignalsSubscriber } from '../infrastructure/convex/subscribers/assigned-task-signals.js';
import { startCommandEventsSubscriber } from '../infrastructure/convex/subscribers/command-events.js';
import { startCommandRunSubscriber } from '../infrastructure/convex/subscribers/command-run.js';
import { startDaemonOrchestrationIntentsSubscriber } from '../infrastructure/convex/subscribers/daemon-orchestration-intents.js';
import { startDirectHarnessCommandSubscriber } from '../infrastructure/convex/subscribers/direct-harness-command.js';
import { startDirectHarnessPromptSubscriber } from '../infrastructure/convex/subscribers/direct-harness-prompt.js';
import { startDirectHarnessSessionSubscriber } from '../infrastructure/convex/subscribers/direct-harness-session.js';
import { startEnhancerJobSubscriber } from '../infrastructure/convex/subscribers/enhancer-job.js';
import { startFileContentRequestSubscriber } from '../infrastructure/convex/subscribers/file-content-request.js';
import { startFileTreeRequestSubscriber } from '../infrastructure/convex/subscribers/file-tree-request.js';
import { startFileWriteRequestSubscriber } from '../infrastructure/convex/subscribers/file-write-request.js';
import { startGitRequestSubscriber } from '../infrastructure/convex/subscribers/git-request.js';
import { startWorkspaceListSubscriber } from '../infrastructure/convex/subscribers/workspace-list.js';
import { startInboundSubscribers } from '../infrastructure/inbound/convex/subscriber-registry.js';
import {
  isDaemonOrchestrationP5Enabled,
  isDaemonOrchestrationP7Enabled,
} from '../infrastructure/projection/feature-flags.js';

export type SubscriberRegistryDeps = ConvexSubscriberDeps & {
  router: EventRouterDeps;
};

export type SubscriberRegistryHandle = { stopAll(): Promise<void> };

export function startAllSubscribers(deps: SubscriberRegistryDeps): SubscriberRegistryHandle {
  const onEvent = (event: InboundEvent): void => {
    void routeInboundEvent(deps.router, event);
  };

  // P5: inbound-only Convex subscription — orchestration subscribers
  // (assigned-task signals/presence, enhancer-job) are not registered because
  // the daemon no longer subscribes to its own projected state.
  if (isDaemonOrchestrationP5Enabled()) {
    return startInboundSubscribers(deps, onEvent);
  }

  const signals = startAssignedTaskSignalsSubscriber(deps, onEvent);
  const presence = startAssignedTaskPresenceSubscriber(deps, onEvent);
  const session = startDirectHarnessSessionSubscriber(deps, onEvent);
  const prompt = startDirectHarnessPromptSubscriber(deps, onEvent);
  const directHarnessCommand = startDirectHarnessCommandSubscriber(deps, onEvent);
  const commandEvents = startCommandEventsSubscriber(deps, onEvent);
  const commandRun = startCommandRunSubscriber(deps, onEvent);
  const workspaceList = startWorkspaceListSubscriber(deps, onEvent);
  const gitRequest = startGitRequestSubscriber(deps, onEvent);
  const fileTree = startFileTreeRequestSubscriber(deps, onEvent);
  const fileContent = startFileContentRequestSubscriber(deps, onEvent);
  const fileWrite = startFileWriteRequestSubscriber(deps, onEvent);
  const agenticQuerySession = startAgenticQuerySessionSubscriber(deps, onEvent);
  const agenticQueryPrompt = startAgenticQueryPromptSubscriber(deps, onEvent);
  const enhancerJob = startEnhancerJobSubscriber(deps, onEvent);
  const orchestrationIntents = isDaemonOrchestrationP7Enabled()
    ? startDaemonOrchestrationIntentsSubscriber(deps, onEvent)
    : undefined;

  return {
    async stopAll() {
      await Promise.all([
        signals.stop(),
        presence.stop(),
        session.stop(),
        prompt.stop(),
        directHarnessCommand.stop(),
        commandEvents.stop(),
        commandRun.stop(),
        workspaceList.stop(),
        gitRequest.stop(),
        fileTree.stop(),
        fileContent.stop(),
        fileWrite.stop(),
        agenticQuerySession.stop(),
        agenticQueryPrompt.stop(),
        enhancerJob.stop(),
        orchestrationIntents?.stop(),
      ]);
    },
  };
}
