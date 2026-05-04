/**
 * Barrel re-export for the domain/direct-harness module.
 *
 * Domain is split into three sub-modules:
 * - entities/  — Core domain types and data structures
 * - ports/     — Interface/port definitions (repositories, publishers, etc.)
 * - usecases/  — Domain-level use cases and business logic
 *
 * Import from this barrel for convenience:
 *   import type { Workspace } from '../domain/direct-harness/index.js';
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

export type { SessionRepository } from './ports/session-repository.js';
export type { OutputRepository, OutputChunk } from './ports/output-repository.js';
export type { PromptRepository, PromptOverride } from './ports/prompt-repository.js';

// ─── Use cases ──────────────────────────────────────────────────────────────────

export { openSession } from './usecases/open-session.js';
export type {
  OpenSessionDeps,
  OpenSessionInput,
  SessionHandle,
  SpawnerProvider,
  SessionJournal,
  JournalFactory,
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
} from './usecases/prompt-session.js';

export { closeSession } from './usecases/close-session.js';
export type {
  CloseSessionDeps,
  CloseSessionInput,
} from './usecases/close-session.js';

export { publishCapabilities } from './usecases/publish-capabilities.js';
export type {
  PublishCapabilitiesDeps,
  PublishCapabilitiesInput,
  CapabilitiesCollector,
  CollectorResolver,
} from './usecases/publish-capabilities.js';
