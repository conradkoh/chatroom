import type { OutboundEvent } from '../domain/entities/outbound-event.js';
import { createAssignedTaskStatusPublisher } from '../infrastructure/convex/publishers/assigned-task-status.js';
import { createCapabilitiesPublisher } from '../infrastructure/convex/publishers/capabilities.js';
import { createCommandResultPublisher } from '../infrastructure/convex/publishers/command-result.js';
import { createDaemonHeartbeatPublisher } from '../infrastructure/convex/publishers/daemon-heartbeat.js';
import { createGitStatePublisher } from '../infrastructure/convex/publishers/git-state.js';
import { createHarnessFingerprintPublisher } from '../infrastructure/convex/publishers/harness-fingerprint.js';
import { createModelsPublisher } from '../infrastructure/convex/publishers/models.js';
import type { ConvexPublisherDeps } from '../infrastructure/convex/publishers/publisher-deps.js';
import { createSessionLifecyclePublisher } from '../infrastructure/convex/publishers/session-lifecycle.js';
import { createTurnOutputPublisher } from '../infrastructure/convex/publishers/turn-output.js';
import { createWorkspaceCommandsPublisher } from '../infrastructure/convex/publishers/workspace-commands.js';
import type { PersistenceStore } from '../infrastructure/persistence/index.js';
import type { StreamHub } from '../local-web/server/stream-hub.js';

export type PublisherRegistryDeps = {
  persistence?: PersistenceStore;
  streamHub?: StreamHub;
  backend?: ConvexPublisherDeps['backend'];
  sessionId?: string;
  machineId?: string;
  logEvent?: ConvexPublisherDeps['logEvent'];
};

export type PublisherRegistry = {
  publish(event: OutboundEvent): Promise<void>;
};

function createConvexPublishers(deps: ConvexPublisherDeps) {
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

function routeConvexEvent(
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

export function createPublisherRegistry(deps: PublisherRegistryDeps = {}): PublisherRegistry {
  const convexDeps =
    deps.backend && deps.sessionId && deps.machineId && deps.logEvent
      ? {
          backend: deps.backend,
          sessionId: deps.sessionId,
          machineId: deps.machineId,
          logEvent: deps.logEvent,
        }
      : undefined;
  const publishers = convexDeps ? createConvexPublishers(convexDeps) : undefined;

  return {
    async publish(event) {
      deps.persistence?.append(event);
      if (event.type === 'harness.stream') {
        deps.streamHub?.publish(event);
        return;
      }

      if (!publishers) return;

      return routeConvexEvent(publishers, event);
    },
  };
}
