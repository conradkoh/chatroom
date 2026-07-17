import type { HarnessTurnView } from '../../src/domain/direct-harness/types';
import type { QueryCtx } from '../_generated/server';

/** Minimal turn row fields needed for wire view mapping. */
export type HarnessTurnRow = {
  _id: string;
  turnSeq: number;
  role: 'user' | 'assistant';
  status: 'pending' | 'streaming' | 'complete' | 'failed';
  messageId?: string;
  textContent: string;
  reasoningContent: string;
  startedAt: number;
  completedAt?: number;
};

export function toHarnessTurnView(row: HarnessTurnRow): HarnessTurnView {
  return {
    _id: row._id as HarnessTurnView['_id'],
    turnSeq: row.turnSeq,
    role: row.role,
    status: row.status,
    messageId: row.messageId,
    textContent: row.textContent,
    reasoningContent: row.reasoningContent,
    startedAt: row.startedAt,
    completedAt: row.completedAt,
  };
}

/** Given desc-ordered rows already fetched with `limit + 1`, build oldest-first page. */
export function buildLatestTurnsPage(
  rows: HarnessTurnRow[],
  limit: number
): { turns: HarnessTurnView[]; hasMore: boolean; newestTurnSeq: number | null } {
  const hasMore = rows.length > limit;
  const turns = rows.slice(0, limit).reverse().map(toHarnessTurnView);
  const newestTurnSeq = turns.at(-1)?.turnSeq ?? null;
  return { turns, hasMore, newestTurnSeq };
}

/** Given desc-ordered rows already fetched with `limit + 1`, build oldest-first page (no newestTurnSeq). */
export function buildOlderTurnsPage(
  rows: HarnessTurnRow[],
  limit: number
): { turns: HarnessTurnView[]; hasMore: boolean } {
  const hasMore = rows.length > limit;
  const turns = rows.slice(0, limit).reverse().map(toHarnessTurnView);
  return { turns, hasMore };
}

type StreamingChunkTable = 'chatroom_harnessSessionMessages' | 'chatroom_agenticQueryRunMessages';

/** Shared streaming chunk fetch (cursor + initial-load paths). */
export async function fetchStreamingTurnChunks(
  ctx: QueryCtx,
  table: StreamingChunkTable,
  args: { messageId: string; limit: number; afterCreationTime?: number }
) {
  const baseIdx = ctx.db.query(table).withIndex('by_messageId', (q) => {
    const eq = q.eq('messageId', args.messageId);
    return args.afterCreationTime !== undefined
      ? eq.gte('_creationTime', args.afterCreationTime)
      : eq;
  });

  if (args.afterCreationTime !== undefined) {
    return await baseIdx.order('asc').take(args.limit);
  }

  const rows = await baseIdx.order('desc').take(args.limit);
  rows.sort((a, b) => a._creationTime - b._creationTime);
  return rows;
}
