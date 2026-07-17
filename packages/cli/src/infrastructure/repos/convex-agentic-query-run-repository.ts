import { api } from '../../api.js';
import type { OpenCodeSessionId } from '../../domain/direct-harness/entities/harness-session.js';
import type { SessionRepository } from '../../domain/direct-harness/ports/session-repository.js';
import type { ConvexRepositoryOptions } from './convex-repository-options.js';

export type ConvexAgenticQueryRunRepositoryOptions = ConvexRepositoryOptions;

export class ConvexAgenticQueryRunRepository implements SessionRepository {
  constructor(private readonly options: ConvexAgenticQueryRunRepositoryOptions) {}

  async associateOpenCodeSessionId(
    harnessSessionId: string,
    opencodeSessionId: string,
    sessionTitle: string
  ): Promise<void> {
    const { backend, sessionId } = this.options;
    await backend.mutation(api.daemon.agenticQuery.runs.associateOpenCodeSessionId, {
      sessionId,
      runId: harnessSessionId,
      opencodeSessionId,
      sessionTitle,
    });
  }

  async getOpenCodeSessionId(harnessSessionId: string): Promise<OpenCodeSessionId | undefined> {
    const { backend, sessionId } = this.options;
    const result = (await backend.query(api.daemon.agenticQuery.runs.getRun, {
      sessionId,
      runId: harnessSessionId,
    })) as { opencode?: { opencodeSessionId?: string } } | null;
    return result?.opencode?.opencodeSessionId as OpenCodeSessionId | undefined;
  }

  async markClosed(harnessSessionId: string): Promise<void> {
    const { backend, sessionId } = this.options;
    await backend.mutation(api.daemon.agenticQuery.runs.closeRun, {
      sessionId,
      runId: harnessSessionId,
    });
  }

  async markIdle(harnessSessionId: string): Promise<void> {
    const { backend, sessionId } = this.options;
    await backend.mutation(api.daemon.agenticQuery.runs.markIdle, {
      sessionId,
      runId: harnessSessionId,
    });
  }

  async markFailed(harnessSessionId: string): Promise<void> {
    const { backend, sessionId } = this.options;
    await backend.mutation(api.daemon.agenticQuery.runs.markFailed, {
      sessionId,
      runId: harnessSessionId,
    });
  }

  async markActive(harnessSessionId: string): Promise<void> {
    const { backend, sessionId } = this.options;
    await backend.mutation(api.daemon.agenticQuery.runs.markActive, {
      sessionId,
      runId: harnessSessionId,
    });
  }

  async markTurnProcessed(harnessSessionId: string, turnSeq: number): Promise<void> {
    const { backend, sessionId } = this.options;
    await backend.mutation(api.daemon.agenticQuery.turns.markTurnProcessed, {
      sessionId,
      runId: harnessSessionId,
      turnSeq,
    });
  }

  async setGenerating(harnessSessionId: string, isGenerating: boolean): Promise<void> {
    const { backend, sessionId } = this.options;
    await backend.mutation(api.daemon.agenticQuery.queue.setGenerating, {
      sessionId,
      runId: harnessSessionId,
      isGenerating,
    });
  }

  async dequeueNext(harnessSessionId: string): Promise<{ content: string; seq: number } | null> {
    const { backend, sessionId } = this.options;
    await backend.mutation(api.daemon.agenticQuery.queue.dequeueNext, {
      sessionId,
      runId: harnessSessionId,
    });
    return null;
  }

  async beginAssistantTurn(harnessSessionId: string): Promise<{ turnId: string; turnSeq: number }> {
    const { backend, sessionId } = this.options;
    return backend.mutation(api.daemon.agenticQuery.turns.beginAssistantTurn, {
      sessionId,
      runId: harnessSessionId,
    }) as Promise<{ turnId: string; turnSeq: number }>;
  }

  async bindTurnMessageId(turnId: string, messageId: string): Promise<void> {
    const { backend, sessionId } = this.options;
    await backend.mutation(api.daemon.agenticQuery.turns.bindTurnMessageId, {
      sessionId,
      turnId,
      messageId,
    });
  }

  async finalizeAssistantTurn(turnId: string): Promise<void> {
    const { backend, sessionId } = this.options;
    await backend.mutation(api.daemon.agenticQuery.turns.finalizeAssistantTurn, {
      sessionId,
      turnId,
    });
  }

  async updateSessionTitle(harnessSessionId: string, title: string): Promise<void> {
    // Agentic query runs do not sync OpenCode session titles to the webapp tab.
    void harnessSessionId;
    void title;
  }
}
