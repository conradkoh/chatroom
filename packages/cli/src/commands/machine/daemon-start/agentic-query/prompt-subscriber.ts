import type { ConvexClient } from 'convex/browser';

import { renderWorkspaceAgentSystemPrompt } from '@workspace/backend/prompts/agentic-query/workspace-agent-system-prompt.js';

import type { ActiveSession } from '../direct-harness/session-subscriber.js';
import { api } from '../../../../api.js';
import type { BoundHarness } from '../../../../domain/direct-harness/entities/bound-harness.js';
import type { SessionRepository } from '../../../../domain/direct-harness/ports/session-repository.js';
import type { JournalFactory } from '../../../../domain/direct-harness/usecases/open-session.js';
import { resumeSession } from '../../../../domain/direct-harness/usecases/resume-session.js';
import { createChunkExtractor } from '../../../../infrastructure/harnesses/registry.js';
import type { AgenticQuerySubscriptionSession } from './start-subscriptions.js';

interface SubscriberDeps {
  activeSessions: Map<string, ActiveSession>;
  harnesses: Map<string, BoundHarness>;
  sessionRepository: SessionRepository;
  journalFactory: JournalFactory;
}

export function startPromptSubscriber(
  daemonSession: AgenticQuerySubscriptionSession,
  wsClient: ConvexClient,
  deps: SubscriberDeps
): { stop: () => void } {
  const handle = wsClient.onUpdate(
    api.daemon.agenticQuery.messages.pendingForMachine,
    { sessionId: daemonSession.sessionId, machineId: daemonSession.machineId },
    async (batch) => {
      if (!batch) return;
      const raw = batch as unknown as {
        sessions: {
          _id: string;
          workspaceId: string;
          harnessName: string;
          opencodeSessionId: string | undefined;
          agenticQueryId: string;
          chatroomId: string;
          lastUsedConfig: { agent: string; model?: { providerID: string; modelID: string } };
        }[];
        messages: { harnessSessionId: string; content: string; seq: number }[];
      };

      for (const info of raw.sessions) {
        const rowId = info._id;
        let existingSession = deps.activeSessions.get(rowId);

        // Resume if handle is missing but opencodeSessionId is set
        if (!existingSession && info.opencodeSessionId && info.harnessName) {
          const harnessKey = `${info.workspaceId}::${info.harnessName}`;
          const harness = deps.harnesses.get(harnessKey);
          if (harness) {
            try {
              existingSession = await resumeSession(
                {
                  harness,
                  journalFactory: deps.journalFactory,
                  chunkExtractor: createChunkExtractor(info.harnessName as any),
                },
                {
                  harnessSessionId: rowId,
                  opencodeSessionId: info.opencodeSessionId,
                  workspaceId: info.workspaceId,
                  harnessName: info.harnessName,
                }
              );
              deps.activeSessions.set(rowId, existingSession);
              console.log(`[agentic-query] Resumed session ${rowId}`);
            } catch (err) {
              console.warn(
                `[agentic-query] Resume failed for ${rowId}: ${err instanceof Error ? err.message : String(err)}`
              );
              continue;
            }
          } else {
            console.log(`[agentic-query] No harness for ${rowId} — waiting for session-subscriber`);
            continue;
          }
        }

        if (!existingSession) {
          continue;
        }

        const pendingMsgs = raw.messages
          .filter((m) => m.harnessSessionId === rowId)
          .sort((a, b) => a.seq - b.seq);

        for (const msg of pendingMsgs) {
          await deps.sessionRepository.setGenerating(rowId, true);

          const { turnId } = await deps.sessionRepository.beginAssistantTurn(rowId);

          await existingSession.session.prompt({
            parts: [{ type: 'text', text: msg.content }],
            agent: info.lastUsedConfig.agent,
            ...(info.lastUsedConfig.model ? { model: info.lastUsedConfig.model } : {}),
            system: renderWorkspaceAgentSystemPrompt({
              convexUrl: daemonSession.convexUrl,
              chatroomId: info.chatroomId,
              queryId: info.agenticQueryId,
            }),
          });

          // Finalize turn
          if (existingSession.currentTurn) {
            const { turnId: finalTurnId } = existingSession.currentTurn;
            existingSession.currentTurn = null;
            try {
              await existingSession.journal.flush();
              await deps.sessionRepository.finalizeAssistantTurn(finalTurnId);
            } catch {
              existingSession.currentTurn = { turnId: finalTurnId, messageId: null };
            }
          }

          try {
            await deps.sessionRepository.markTurnProcessed(rowId, msg.seq);
          } catch (err) {
            console.warn(
              `[agentic-query] markTurnProcessed failed for session ${rowId} seq=${msg.seq}: ${err}`
            );
          }
        }
      }
    }
  );

  return { stop: handle };
}
