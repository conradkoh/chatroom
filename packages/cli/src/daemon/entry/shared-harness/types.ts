import type { SessionId } from '../../../commands/machine/daemon-start/types.js';
import type { BackendOps } from '../../../infrastructure/deps/index.js';
import type { BoundHarness } from '../../domain/entities/bound-harness.js';
import type {
  SessionRepository,
  JournalFactory,
  SessionHandle,
} from '../../domain/usecase/open-harness-session.js';

export type HarnessWorkerSession = {
  readonly sessionId: SessionId;
  readonly backend: BackendOps;
  readonly convexUrl: string;
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
