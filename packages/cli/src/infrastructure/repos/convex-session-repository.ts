/**
 * Convex-backed SessionRepository.
 *
 * Maps the domain SessionRepository port to Convex mutations/queries:
 *   - createSession       → sessions.openSession mutation
 *   - associateHarnessSessionId → sessions.associateHarnessSessionId mutation
 *   - getHarnessSessionId → sessions.getSession query
 *   - markClosed          → sessions.closeSession mutation
 */

import { api } from '../../api.js';
import type { SessionRepository } from '../../domain/direct-harness/ports/session-repository.js';
import type { HarnessSessionId } from '../../domain/direct-harness/entities/harness-session.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type BackendCall = (endpoint: any, args: any) => Promise<any>;

export interface ConvexSessionRepositoryOptions {
  readonly backend: { mutation: BackendCall; query: BackendCall };
  readonly sessionId: string;
}

export class ConvexSessionRepository implements SessionRepository {
  constructor(private readonly options: ConvexSessionRepositoryOptions) {}

  async createSession(
    workspaceId: string,
    harnessName: string,
    config: { agent: string }
  ): Promise<{ harnessSessionRowId: string }> {
    const { backend, sessionId } = this.options;

    return backend.mutation(api.chatroom.directHarness.sessions.openSession, {
      sessionId,
      workspaceId,
      name: harnessName,
      config,
    }) as Promise<{ harnessSessionRowId: string }>;
  }

  async associateHarnessSessionId(
    harnessSessionRowId: string,
    harnessSessionId: string,
    sessionTitle: string
  ): Promise<void> {
    const { backend, sessionId } = this.options;

    await backend.mutation(api.chatroom.directHarness.sessions.associateHarnessSessionId, {
      sessionId,
      harnessSessionRowId,
      harnessSessionId,
      sessionTitle,
    });
  }

  async getHarnessSessionId(harnessSessionRowId: string): Promise<HarnessSessionId | undefined> {
    const { backend } = this.options;

    const result = await backend.query(api.chatroom.directHarness.sessions.getSession, {
      harnessSessionRowId,
    }) as { harnessSessionId?: string } | null;

    return result?.harnessSessionId as HarnessSessionId | undefined;
  }

  async markClosed(harnessSessionRowId: string): Promise<void> {
    const { backend, sessionId } = this.options;

    await backend.mutation(api.chatroom.directHarness.sessions.closeSession, {
      sessionId,
      harnessSessionRowId,
    });
  }
}
