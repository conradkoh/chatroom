/**
 * Barrel re-export for infrastructure/repos.
 *
 * Repository port implementations backed by Convex.
 */

export { ConvexSessionRepository } from './convex-session-repository.js';
export type { ConvexSessionRepositoryOptions } from './convex-session-repository.js';

export { ConvexOutputRepository } from './convex-output-repository.js';
export type { ConvexOutputRepositoryOptions } from './convex-output-repository.js';

export { ConvexPromptRepository } from './convex-prompt-repository.js';
export type { ConvexPromptRepositoryOptions } from './convex-prompt-repository.js';

export { ConvexCapabilitiesPublisher } from './convex-capabilities-publisher.js';
export type {
  ConvexCapabilitiesPublisherOptions,
  CapabilitiesTransportBackend,
} from './convex-capabilities-publisher.js';

export { InMemoryCollectorRegistry } from './convex-collector-resolver.js';

export { BufferedJournalFactory } from './journal-factory.js';
export type { BufferedJournalFactoryOptions } from './journal-factory.js';
