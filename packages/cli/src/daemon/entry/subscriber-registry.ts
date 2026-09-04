import { dispatchCommandInboundEvent } from './command-inbound-registry.js';
import { routeInboundEvent, type EventRouterDeps } from './event-router.js';
import type { InboundEvent } from '../domain/entities/inbound-event.js';
import type { ConvexSubscriberDeps } from '../infrastructure/convex/subscriber-deps.js';
import { startAgenticQueryPromptSubscriber } from '../infrastructure/convex/subscribers/agentic-query-prompt.js';
import { startAgenticQuerySessionSubscriber } from '../infrastructure/convex/subscribers/agentic-query-session.js';
import { startCommandRunSubscriber } from '../infrastructure/convex/subscribers/command-run.js';
import { startEnhancerJobSubscriber } from '../infrastructure/convex/subscribers/enhancer-job.js';
import { startFileContentRequestSubscriber } from '../infrastructure/convex/subscribers/file-content-request.js';
import { startFileTreeReleaseRequestSubscriber } from '../infrastructure/convex/subscribers/file-tree-release-request.js';
import { startFileTreeRequestSubscriber } from '../infrastructure/convex/subscribers/file-tree-request.js';
import { startFileWriteRequestSubscriber } from '../infrastructure/convex/subscribers/file-write-request.js';
import { startGitRequestSubscriber } from '../infrastructure/convex/subscribers/git-request.js';
import { startMachineCommandInboxSubscriber } from '../infrastructure/convex/subscribers/machine-command-inbox.js';

export type SubscriberRegistryDeps = ConvexSubscriberDeps & {
  router: EventRouterDeps;
};

export type SubscriberRegistryHandle = { stopAll(): Promise<void> };

export function startAllSubscribers(deps: SubscriberRegistryDeps): SubscriberRegistryHandle {
  const onEvent = (event: InboundEvent): void => {
    void routeInboundEvent(deps.router, event);
  };

  const gitRequest = startGitRequestSubscriber(deps, onEvent);

  const machineCommands = startMachineCommandInboxSubscriber(deps, async (claimed) => {
    // Workspace membership nudges keep the per-workspace git watches in sync
    // (e.g. a newly registered workspace enables git request processing there).
    if (claimed.type === 'daemon.workspaceListChanged') void gitRequest.refreshWorkspaces();
    await dispatchCommandInboundEvent({
      type: 'command.received',
      commandId: claimed.commandId,
      claimedCommand: claimed,
    });
  });
  const commandRun = startCommandRunSubscriber(deps, onEvent);
  const fileTree = startFileTreeRequestSubscriber(deps, onEvent);
  const fileTreeRelease = startFileTreeReleaseRequestSubscriber(deps, onEvent);
  const fileContent = startFileContentRequestSubscriber(deps, onEvent);
  const fileWrite = startFileWriteRequestSubscriber(deps, onEvent);
  const agenticQuerySession = startAgenticQuerySessionSubscriber(deps, onEvent);
  const agenticQueryPrompt = startAgenticQueryPromptSubscriber(deps, onEvent);
  const enhancerJob = startEnhancerJobSubscriber(deps, onEvent);

  return {
    async stopAll() {
      await Promise.all([
        machineCommands.stop(),
        commandRun.stop(),
        gitRequest.stop(),
        fileTree.stop(),
        fileTreeRelease.stop(),
        fileContent.stop(),
        fileWrite.stop(),
        agenticQuerySession.stop(),
        agenticQueryPrompt.stop(),
        enhancerJob.stop(),
      ]);
    },
  };
}
