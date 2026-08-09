import { createAgentLifecycleProjector } from './handlers/project-agent-status.js';
import type { OutboundEvent } from '../../../domain/entities/outbound-event.js';
import { createAssignedTaskStatusPublisher } from '../../convex/publishers/assigned-task-status.js';
import { createCapabilitiesPublisher } from '../../convex/publishers/capabilities.js';
import { createCommandResultPublisher } from '../../convex/publishers/command-result.js';
import { createDaemonHeartbeatPublisher } from '../../convex/publishers/daemon-heartbeat.js';
import { createGitStatePublisher } from '../../convex/publishers/git-state.js';
import { createHandoffCompletedPublisher } from '../../convex/publishers/handoff-completed.js';
import { createHarnessFingerprintPublisher } from '../../convex/publishers/harness-fingerprint.js';
import { createModelsPublisher } from '../../convex/publishers/models.js';
import type { ConvexPublisherDeps } from '../../convex/publishers/publisher-deps.js';
import { createSessionLifecyclePublisher } from '../../convex/publishers/session-lifecycle.js';
import { createTurnOutputPublisher } from '../../convex/publishers/turn-output.js';
import { createUserMessageReceivedPublisher } from '../../convex/publishers/user-message-received.js';
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
    handoffCompleted: createHandoffCompletedPublisher(deps),
    userMessageReceived: createUserMessageReceivedPublisher(deps),
    agentLifecycle: createAgentLifecycleProjector(deps),
  };
}

export type ConvexPublisherSet = ReturnType<typeof createConvexPublishers>;

/** Resolve the publisher handler for an event without invoking it. */
// fallow-ignore-next-line complexity
export function getConvexEventHandler(
  publishers: ConvexPublisherSet,
  event: OutboundEvent
): ((event: OutboundEvent) => Promise<void>) | undefined {
  switch (event.type) {
    case 'heartbeat':
      return publishers.heartbeat.publish.bind(publishers.heartbeat);
    case 'turn.chunk':
    case 'turn.completed':
      return publishers.turnOutput.publish.bind(publishers.turnOutput);
    case 'session.lifecycle':
      return publishers.sessionLifecycle.publish.bind(publishers.sessionLifecycle);
    case 'task.status':
      return publishers.assignedTaskStatus.publish.bind(publishers.assignedTaskStatus);
    case 'git.state':
      return publishers.gitState.publish.bind(publishers.gitState);
    case 'capabilities.updated':
      return publishers.capabilities.publish.bind(publishers.capabilities);
    case 'models.updated':
      return publishers.models.publish.bind(publishers.models);
    case 'harness.fingerprint.updated':
      return publishers.harnessFingerprint.publish.bind(publishers.harnessFingerprint);
    case 'command.result.ping':
    case 'command.result.folder-picker':
    case 'command.result.capabilities-refresh':
      return publishers.commandResult.publish.bind(publishers.commandResult);
    case 'workspace.commands':
      return publishers.workspaceCommands.publish.bind(publishers.workspaceCommands);
    case 'handoff.completed':
      return publishers.handoffCompleted.publish.bind(publishers.handoffCompleted);
    case 'user-message.received':
      return publishers.userMessageReceived.publish.bind(publishers.userMessageReceived);
    case 'agent.start_failed':
    case 'agent.stop_timeout':
    case 'session.resume_requested':
    case 'session.resumed':
    case 'session.resume_failed':
    case 'session.reopen_retry':
    case 'harness.session_id_updated':
    case 'restart.limit_reached':
    case 'agent.native_end':
    case 'restart.phase':
    case 'restart.completed':
    case 'task.claimed':
    case 'task.status_changed':
      return publishers.agentLifecycle.publish.bind(publishers.agentLifecycle);
    default:
      return undefined;
  }
}

// fallow-ignore-next-line complexity
export function routeConvexEvent(
  publishers: ConvexPublisherSet,
  event: OutboundEvent
): Promise<void> | undefined {
  return getConvexEventHandler(publishers, event)?.(event);
}

// fallow-ignore-next-line unused-export
export function hasConvexEventHandler(
  publishers: ConvexPublisherSet,
  event: OutboundEvent
): boolean {
  return getConvexEventHandler(publishers, event) !== undefined;
}

export function assertProjectableEvent(publishers: ConvexPublisherSet, event: OutboundEvent): void {
  if (!hasConvexEventHandler(publishers, event)) {
    throw new Error(`No projection handler for event type: ${event.type}`);
  }
}
