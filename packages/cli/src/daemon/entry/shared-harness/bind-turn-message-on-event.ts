import type { ActiveSession } from './types.js';
import type { SessionRepository } from '../../domain/usecase/open-harness-session.js';

/** Bind harness turn messageId to Convex when the SDK assigns one mid-turn. */
export function bindTurnMessageOnEvent(
  handle: ActiveSession,
  sessionRepository: SessionRepository,
  logPrefix: string
): () => void {
  let lastBoundKey: string | null = null;
  return () => {
    const turn = handle.currentTurn;
    if (!turn) return;
    const messageId = turn.messageId;
    if (messageId == null) return;

    const key = `${turn.turnId}:${messageId}`;
    if (key === lastBoundKey) return;

    lastBoundKey = key;
    sessionRepository
      .bindTurnMessageId(turn.turnId, messageId)
      .catch((err: unknown) =>
        console.warn(`[${logPrefix}] bindTurnMessageId error (resume):`, err)
      );
  };
}
