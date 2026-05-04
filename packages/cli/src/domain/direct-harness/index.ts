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

// ─── Use cases ──────────────────────────────────────────────────────────────────

export { openSession } from './usecases/open-session.js';
export type {
  OpenSessionDeps,
  OpenSessionInput,
  OpenSessionResult,
  SessionRepository,
  SpawnerProvider,
} from './usecases/open-session.js';

export { resumeSession } from './usecases/resume-session.js';
export type {
  ResumeSessionDeps,
  ResumeSessionInput,
  ResumeSessionResult,
} from './usecases/resume-session.js';

export { promptSession } from './usecases/prompt-session.js';
export type {
  PromptSessionDeps,
  PromptSessionInput,
  PromptOverride,
  SessionQueryPort,
  PromptOverrideQueryPort,
  PromptCompletionPort,
} from './usecases/prompt-session.js';

export { closeSession } from './usecases/close-session.js';
export type {
  CloseSessionDeps,
  CloseSessionInput,
  SessionStatusPort,
} from './usecases/close-session.js';

export { publishCapabilities } from './usecases/publish-capabilities.js';
export type {
  PublishCapabilitiesDeps,
  PublishCapabilitiesInput,
  CapabilitiesCollector,
  CollectorResolver,
} from './usecases/publish-capabilities.js';

export { wireSessionToBus } from './usecases/wire-session-to-bus.js';
export type {
  WireSessionToBusDeps,
} from './usecases/wire-session-to-bus.js';
