import type { OutboundEvent } from '../../../domain/entities/outbound-event.js';
import { createAssignedTaskStatusPublisher } from '../../convex/publishers/assigned-task-status.js';
import { createCapabilitiesPublisher } from '../../convex/publishers/capabilities.js';
import { createCommandResultPublisher } from '../../convex/publishers/command-result.js';
import { createDaemonHeartbeatPublisher } from '../../convex/publishers/daemon-heartbeat.js';
import { createGitStatePublisher } from '../../convex/publishers/git-state.js';
import { createHarnessFingerprintPublisher } from '../../convex/publishers/harness-fingerprint.js';
import { createModelsPublisher } from '../../convex/publishers/models.js';
import type { ConvexPublisherDeps } from '../../convex/publishers/publisher-deps.js';
import { createSessionLifecyclePublisher } from '../../convex/publishers/session-lifecycle.js';
import { createTurnOutputPublisher } from '../../convex/publishers/turn-output.js';
import { createWorkspaceCommandsPublisher } from '../../convex/publishers/workspace-commands.js';

export function createConvexPublishers(deps: ConvexPublisherDeps) {
  return {
    heartbeat: createDaemonHeartbeatPublisher(deps),
    turnOutput: createTurnOutputPublisher(deps),
    sessionLifecycle: createSessionLifecyclePublisher(deps),
    assignedTaskStatus: createAssignedTaskStatusPublisher(deps),
    gitState: createGitStatePublisher(deps),
    capabilities: createCapabilitiesPublisher(deps),
    models: createModelsPublisher(deps),
    harnessFingerprint: createHarnessFingerprintPublisher(deps),
    commandResult: createCommandResultPublisher(deps),
    workspaceCommands: createWorkspaceCommandsPublisher(deps),
  };
}

// fallow-ignore-next-line complexity
export function routeConvexEvent(
  publishers: ReturnType<typeof createConvexPublishers>,
  event: OutboundEvent
): Promise<void> | undefined {
  switch (event.type) {
    case 'heartbeat':
      return publishers.heartbeat.publish(event);
    case 'turn.chunk':
    case 'turn.completed':
      return publishers.turnOutput.publish(event);
    case 'session.lifecycle':
      return publishers.sessionLifecycle.publish(event);
    case 'task.status':
      return publishers.assignedTaskStatus.publish(event);
    case 'git.state':
      return publishers.gitState.publish(event);
    case 'capabilities.updated':
      return publishers.capabilities.publish(event);
    case 'models.updated':
      return publishers.models.publish(event);
    case 'harness.fingerprint.updated':
      return publishers.harnessFingerprint.publish(event);
    case 'command.result.ping':
    case 'command.result.folder-picker':
    case 'command.result.capabilities-refresh':
      return publishers.commandResult.publish(event);
    case 'workspace.commands':
      return publishers.workspaceCommands.publish(event);
    default:
      return undefined;
  }
}

export function assertProjectableEvent(
  publishers: ReturnType<typeof createConvexPublishers>,
  event: OutboundEvent
): void {
  if (routeConvexEvent(publishers, event) === undefined) {
    throw new Error(`No projection handler for event type: ${event.type}`);
  }
}
