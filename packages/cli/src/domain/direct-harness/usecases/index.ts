/**
 * Barrel re-export for domain/direct-harness/usecases.
 *
 * Domain use cases orchestrate business logic between entities and ports
 * without depending on concrete infrastructure.
 */

export { openSession } from './open-session.js';
export type {
  OpenSessionDeps,
  OpenSessionInput,
  SessionHandle,
  SpawnerProvider,
  SessionJournal,
  JournalFactory,
} from './open-session.js';

export { resumeSession } from './resume-session.js';
export type {
  ResumeSessionDeps,
  ResumeSessionInput,
  ResumeSessionResult,
} from './resume-session.js';

export { promptSession } from './prompt-session.js';
export type {
  PromptSessionDeps,
  PromptSessionInput,
} from './prompt-session.js';

export { closeSession } from './close-session.js';
export type {
  CloseSessionDeps,
  CloseSessionInput,
} from './close-session.js';

export { publishCapabilities } from './publish-capabilities.js';
export type {
  PublishCapabilitiesDeps,
  PublishCapabilitiesInput,
  CapabilitiesCollector,
  CollectorResolver,
} from './publish-capabilities.js';
