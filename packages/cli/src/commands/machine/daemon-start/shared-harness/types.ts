import type { BoundHarness } from '../../../../domain/direct-harness/entities/bound-harness.js';
import type { SessionRepository } from '../../../../domain/direct-harness/ports/session-repository.js';
import type {
  JournalFactory,
  SessionHandle,
} from '../../../../domain/direct-harness/usecases/open-session.js';
import type { BackendOps } from '../../../../infrastructure/deps/index.js';
import type { SessionId } from '../types.js';

export type HarnessWorkerSession = {
  sessionId: SessionId;
  backend: BackendOps;
  convexUrl: string;
};

export type SharedHarnessMaps = {
  activeSessions: Map<string, SessionHandle>;
  harnesses: Map<string, BoundHarness>;
  sessionRepository: SessionRepository;
  journalFactory: JournalFactory;
};

export type OpenPendingHarnessSessionInput = {
  rowId: string;
  workspaceId: string;
  harnessName: string;
  lastUsedConfig: {
    agent: string;
    model?: { providerID: string; modelID: string };
  };
};
