import { api } from '../../api.js';
import type { SessionRepository } from '../../domain/direct-harness/ports/session-repository.js';
import type { OpenCodeSessionId } from '../../domain/direct-harness/entities/harness-session.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type BackendCall = (endpoint: any, args: any) => Promise<any>;

export interface ConvexSessionRepositoryOptions {
  readonly backend: { mutation: BackendCall; query: BackendCall };
  readonly sessionId: string;
}

export class ConvexSessionRepository implements SessionRepository {
  constructor(private readonly options: ConvexSessionRepositoryOptions) {}

  async associateOpenCodeSessionId(
    harnessSessionId: string,
    opencodeSessionId: string,
    sessionTitle: string
  ): Promise<void> {
    const { backend, sessionId } = this.options;
    await backend.mutation(api.daemon.directHarness.sessions.associateHarnessSessionId, {
      sessionId,
      harnessSessionId,
      opencodeSessionId,
      sessionTitle,
    });
  }

  async getOpenCodeSessionId(harnessSessionId: string): Promise<OpenCodeSessionId | undefined> {
    const result = (await this.options.backend.query(api.daemon.directHarness.sessions.getSession, {
      harnessSessionId,
    })) as { opencodeSessionId?: string } | null;
    return result?.opencodeSessionId as OpenCodeSessionId | undefined;
  }

  async markClosed(harnessSessionId: string): Promise<void> {
    const { backend, sessionId } = this.options;
    await backend.mutation(api.daemon.directHarness.sessions.closeSession, {
      sessionId,
      harnessSessionId,
    });
  }

  async markIdle(harnessSessionId: string): Promise<void> {
    const { backend, sessionId } = this.options;
    await backend.mutation(api.daemon.directHarness.sessions.markIdle, {
      sessionId,
      harnessSessionId,
    });
  }

  async markFailed(harnessSessionId: string): Promise<void> {
    const { backend, sessionId } = this.options;
    await backend.mutation(api.daemon.directHarness.sessions.markFailed, {
      sessionId,
      harnessSessionId,
    });
  }

  async markActive(harnessSessionId: string): Promise<void> {
    const { backend, sessionId } = this.options;
    await backend.mutation(api.daemon.directHarness.sessions.markActive, {
      sessionId,
      harnessSessionId,
    });
  }

  async updateLastProcessedSeq(harnessSessionId: string, seq: number): Promise<void> {
    const { backend, sessionId } = this.options;
    await backend.mutation(api.daemon.directHarness.sessions.updateCursor, {
      sessionId,
      harnessSessionId,
      seq,
    });
  }

  async setGenerating(harnessSessionId: string, isGenerating: boolean): Promise<void> {
    const { backend, sessionId } = this.options;
    await backend.mutation(api.daemon.directHarness.queue.setGenerating, {
      sessionId,
      harnessSessionId,
      isGenerating,
    });
  }

  async dequeueNext(harnessSessionId: string): Promise<{ content: string; seq: number } | null> {
    const { backend, sessionId } = this.options;
    return backend.mutation(api.daemon.directHarness.queue.dequeueNext, {
      sessionId,
      harnessSessionId,
    }) as Promise<{ content: string; seq: number } | null>;
  }

  async beginAssistantTurn(harnessSessionId: string): Promise<{ turnId: string; turnSeq: number }> {
    const { backend, sessionId } = this.options;
    return backend.mutation(api.daemon.directHarness.turns.beginAssistantTurn, {
      sessionId,
      harnessSessionId,
    }) as Promise<{ turnId: string; turnSeq: number }>;
  }

  async bindTurnMessageId(turnId: string, messageId: string): Promise<void> {
    const { backend, sessionId } = this.options;
    await backend.mutation(api.daemon.directHarness.turns.bindTurnMessageId, {
      sessionId,
      turnId,
      messageId,
    });
  }

  async finalizeAssistantTurn(turnId: string): Promise<void> {
    const { backend, sessionId } = this.options;
    await backend.mutation(api.daemon.directHarness.turns.finalizeAssistantTurn, {
      sessionId,
      turnId,
    });
  }
}
