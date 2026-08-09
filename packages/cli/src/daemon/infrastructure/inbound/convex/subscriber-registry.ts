// fallow-ignore-file code-duplication
import type { InboundEvent } from '../../../domain/entities/inbound-event.js';
import type { ConvexSubscriberDeps } from '../../convex/subscriber-deps.js';
import { startAgenticQueryPromptSubscriber } from '../../convex/subscribers/agentic-query-prompt.js';
import { startAgenticQuerySessionSubscriber } from '../../convex/subscribers/agentic-query-session.js';
import { startCommandEventsSubscriber } from '../../convex/subscribers/command-events.js';
import { startCommandRunSubscriber } from '../../convex/subscribers/command-run.js';
import { startDaemonOrchestrationIntentsSubscriber } from '../../convex/subscribers/daemon-orchestration-intents.js';
import { startDirectHarnessCommandSubscriber } from '../../convex/subscribers/direct-harness-command.js';
import { startDirectHarnessPromptSubscriber } from '../../convex/subscribers/direct-harness-prompt.js';
import { startDirectHarnessSessionSubscriber } from '../../convex/subscribers/direct-harness-session.js';
import { startFileContentRequestSubscriber } from '../../convex/subscribers/file-content-request.js';
import { startFileTreeRequestSubscriber } from '../../convex/subscribers/file-tree-request.js';
import { startFileWriteRequestSubscriber } from '../../convex/subscribers/file-write-request.js';
import { startGitRequestSubscriber } from '../../convex/subscribers/git-request.js';
import { startOrchestrationIngressSubscriber } from '../../convex/subscribers/orchestration-ingress.js';
import { startWorkspaceListSubscriber } from '../../convex/subscribers/workspace-list.js';
import {
  isDaemonOrchestrationP7Enabled,
  isDaemonOrchestrationP9UserMessageEnabled,
} from '../../projection/feature-flags.js';

export function startInboundSubscribers(
  deps: ConvexSubscriberDeps,
  onEvent: (event: InboundEvent) => void
): { stopAll(): Promise<void> } {
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
  const orchestrationIntents = isDaemonOrchestrationP7Enabled()
    ? startDaemonOrchestrationIntentsSubscriber(deps, onEvent)
    : undefined;
  const orchestrationIngress = isDaemonOrchestrationP9UserMessageEnabled()
    ? startOrchestrationIngressSubscriber(deps, onEvent)
    : undefined;

  return {
    async stopAll() {
      await Promise.all([
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
        orchestrationIntents?.stop(),
        orchestrationIngress?.stop(),
      ]);
    },
  };
}
