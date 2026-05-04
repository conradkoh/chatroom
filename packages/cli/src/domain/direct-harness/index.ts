/**
 * Barrel re-export for the domain/direct-harness module.
 *
 * Domain is split into three sub-modules:
 * - entities/  — Core domain types and data structures
 * - ports/     — Interface/port definitions (repositories, publishers, etc.)
 * - usecases/  — Domain-level use cases and business logic
 *
 * Import from this barrel for convenience:
 *   import type { Workspace, DirectHarnessSpawner } from '../domain/direct-harness/index.js';
 */

// ─── Entities ─────────────────────────────────────────────────────────────────

export type { ChatroomId, WorkspaceId, Workspace } from './entities/workspace.js';

export type {
  HarnessSessionRowId,
  HarnessSessionId,
  HarnessSessionStatus,
  HarnessSession,
} from './entities/harness-session.js';

export type {
  DirectHarnessSessionEvent,
  PromptPart,
  PromptInput,
  DirectHarnessSession,
} from './entities/direct-harness-session.js';

export type { OpenSessionOptions, DirectHarnessSpawner } from './entities/direct-harness-spawner.js';

export type {
  BoundHarness,
  BoundHarnessFactory,
  ModelInfo,
  NewSessionConfig,
  ResumeHarnessSessionOptions,
  StartBoundHarnessConfig,
} from './entities/bound-harness.js';

export type {
  PublishedAgent,
  PublishedProvider,
  HarnessCapabilities,
  WorkspaceCapabilities,
  MachineCapabilities,
} from './entities/machine-capabilities.js';

// ─── Ports ────────────────────────────────────────────────────────────────────

export type { CapabilitiesPublisher } from './ports/capabilities-publisher.js';

export type {
  HarnessReplicationBus,
  HarnessReplicationEvent,
  HarnessEventFilter,
  HarnessEventHandler,
  TitleChangedEvent,
  MessageChunkEvent,
  UserMessageEvent,
} from './ports/replication-bus.js';

export type {
  HarnessUserTurnPayload,
  HarnessUserTurnIngressPort,
  HarnessReplicationSubscriptionPort,
  HarnessReplicationEmitPort,
  HarnessSessionResolverPort,
  HarnessUseCaseOrchestrationPort,
  HarnessOrchestrationChannelPort,
  HarnessReplicationBusAsEmitSubscribe,
} from './ports/harness-orchestration-ports.js';

export type {
  FlushContext,
  FlushStrategy,
  MessageStreamChunk,
  MessageStreamTransport,
  MessageStreamSink,
  MessageStreamSinkWarning,
} from './ports/index.js';
