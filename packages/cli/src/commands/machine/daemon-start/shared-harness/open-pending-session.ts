// fallow-ignore-next-line complexity

import { handleSessionIdle } from '../direct-harness/idle-handler.js';
import { api } from '../../../../api.js';
import type { DirectHarnessSessionEvent } from '../../../../domain/direct-harness/entities/direct-harness-session.js';
import type { HarnessSessionId } from '../../../../domain/direct-harness/entities/harness-session.js';
import type { SessionHandle } from '../../../../domain/direct-harness/usecases/open-session.js';
import { createChunkExtractor } from '../../../../infrastructure/harnesses/registry.js';
import { isOpenCodeSessionEventType } from '../../../../infrastructure/services/remote-agents/opencode-sdk/opencode-session-events.js';
import { getOrCreateBoundHarness } from './get-or-create-bound-harness.js';
import type {
  HarnessWorkerSession,
  OpenPendingHarnessSessionInput,
  SharedHarnessMaps,
} from './types.js';

export async function openPendingHarnessSession(
  daemonSession: HarnessWorkerSession,
  deps: SharedHarnessMaps,
  input: OpenPendingHarnessSessionInput,
  options: { logPrefix: string; handleProviderIdEvents: boolean }
): Promise<void> {
  const { rowId, workspaceId, harnessName, lastUsedConfig } = input;
  const { logPrefix, handleProviderIdEvents } = options;

  try {
    const workspace = (await daemonSession.backend.query(api.workspaces.getWorkspaceById, {
      sessionId: daemonSession.sessionId,
      workspaceId,
    })) as { workingDir: string } | null;

    if (!workspace) {
      console.warn(`${logPrefix} Workspace ${workspaceId} not found for session ${rowId}`);
      await deps.sessionRepository.markFailed(rowId);
      return;
    }

    const harness = await getOrCreateBoundHarness({
      harnesses: deps.harnesses,
      workspaceId,
      harnessName,
      workingDir: workspace.workingDir,
      convexUrl: daemonSession.convexUrl,
      logPrefix,
    });

    const modelConfig = lastUsedConfig.model;
    const model = modelConfig ? `${modelConfig.providerID}/${modelConfig.modelID}` : undefined;

    const liveSession = await harness.newSession({
      agent: lastUsedConfig.agent,
      model,
      harnessSessionId: rowId as unknown as HarnessSessionId,
    });

    const journal = deps.journalFactory.create(rowId);
    const extractChunk = createChunkExtractor(harness.type);
    const idleConfig = { agent: lastUsedConfig.agent, model: lastUsedConfig.model };

    let unsubscribeEvents: () => void = () => {};
    let closed = false;
    const close = async () => {
      if (closed) return;
      closed = true;
      unsubscribeEvents();
      await journal.commit();
      await liveSession.close();
      await deps.sessionRepository.markClosed(rowId);
      deps.activeSessions.delete(rowId);
    };

    const handle: SessionHandle = {
      harnessSessionId: rowId,
      harnessName,
      opencodeSessionId: liveSession.opencodeSessionId as string,
      workspaceId,
      session: liveSession,
      journal,
      currentTurn: null,
      close,
    };

    unsubscribeEvents = liveSession.onEvent((event: DirectHarnessSessionEvent) => {
      const chunk = extractChunk(event);
      if (chunk !== null) {
        journal.record({
          content: chunk.content,
          timestamp: Date.now(),
          messageId: chunk.messageId,
          partType: chunk.partType,
        });
        if (handle.currentTurn && handle.currentTurn.messageId === null) {
          handle.currentTurn.messageId = chunk.messageId;
          deps.sessionRepository
            .bindTurnMessageId(handle.currentTurn.turnId, chunk.messageId)
            .catch((err: unknown) => console.warn(`${logPrefix} bindTurnMessageId error:`, err));
        }
      }
      if (event.type === 'session.idle') {
        void handleSessionIdle(handle, journal, idleConfig, deps.sessionRepository).catch(
          (err: unknown) => console.warn(`${logPrefix} idle handler error:`, err)
        );
      }
      if (isOpenCodeSessionEventType(event.type) && event.type === 'session.updated') {
        const info = (event.payload as { info?: { title?: string } }).info;
        if (info?.title) {
          deps.sessionRepository
            .updateSessionTitle(rowId, info.title)
            .catch((err: unknown) => console.warn(`${logPrefix} updateSessionTitle error:`, err));
        }
      }
      if (handleProviderIdEvents && event.type === 'session.provider_id') {
        const sessionId = (event.payload as { sessionId?: string }).sessionId;
        if (sessionId && sessionId !== handle.opencodeSessionId) {
          deps.sessionRepository
            .associateOpenCodeSessionId(rowId, sessionId, liveSession.sessionTitle ?? '')
            .catch((err: unknown) =>
              console.warn(`${logPrefix} associateOpenCodeSessionId (provider id) error:`, err)
            );
        }
      }
    });

    deps.activeSessions.set(rowId, handle);

    try {
      await deps.sessionRepository.associateOpenCodeSessionId(
        rowId,
        liveSession.opencodeSessionId as string,
        liveSession.sessionTitle
      );
    } catch (err) {
      deps.activeSessions.delete(rowId);
      await liveSession.close().catch(() => {});
      throw err;
    }

    console.log(
      `${logPrefix} Session opened: ${rowId} agent=${lastUsedConfig.agent} workspace=${workspaceId}`
    );
  } catch (err) {
    console.warn(
      `${logPrefix} Failed to open session ${rowId}:`,
      err instanceof Error ? err.message : String(err)
    );
    try {
      await deps.sessionRepository.markFailed(rowId);
    } catch {
      /* best-effort */
    }
  }
}
