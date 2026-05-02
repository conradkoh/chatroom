/**
 * Barrel re-export for the domain/direct-harness module.
 *
 * Import from this barrel for convenience:
 *   import type { Workspace, DirectHarnessSpawner } from '../domain/direct-harness/index.js';
 */

export type { ChatroomId, WorkspaceId, Workspace } from './workspace.js';

export type {
  HarnessSessionRowId,
  HarnessSessionId,
  HarnessSessionStatus,
  HarnessSession,
} from './harness-session.js';

export type {
  DirectHarnessSessionEvent,
  PromptPart,
  PromptInput,
  DirectHarnessSession,
} from './direct-harness-session.js';

export type { OpenSessionOptions, DirectHarnessSpawner } from './direct-harness-spawner.js';

export type {
  FlushContext,
  FlushStrategy,
  MessageStreamChunk,
  MessageStreamTransport,
  MessageStreamSink,
  MessageStreamSinkWarning,
} from './message-stream/index.js';

export type {
  PublishedAgent,
  PublishedProvider,
  HarnessCapabilities,
  WorkspaceCapabilities,
  MachineCapabilities,
} from './machine-capabilities.js';

export type { CapabilitiesPublisher } from './capabilities-publisher.js';
