import { renderAgenticQueryEnvelope } from '../../../prompts/agentic-query/render-task-envelope';
import type { Doc, Id } from '../../_generated/dataModel';
import type { MutationCtx } from '../../_generated/server';
import { insertAgenticQueryUserTurn } from '../../daemon/agenticQuery/insertUserTurn';

const OPENCODE_AGENT = 'build';

export interface AgenticHarnessSpawnConfig {
  harnessName: string;
  model?: { providerID: string; modelID: string };
}

export async function getAgenticQueryTurns(
  ctx: { db: MutationCtx['db'] },
  agenticQueryId: Id<'chatroom_agenticQueries'>
) {
  return ctx.db
    .query('chatroom_agenticQueryTurns')
    .withIndex('by_agenticQueryId', (q) => q.eq('agenticQueryId', agenticQueryId))
    .collect();
}

export async function getNextAgenticTurnSeq(
  ctx: { db: MutationCtx['db'] },
  agenticQueryId: Id<'chatroom_agenticQueries'>
): Promise<number> {
  const turns = await getAgenticQueryTurns(ctx, agenticQueryId);
  if (turns.length === 0) return 0;
  return Math.max(...turns.map((t) => t.seq)) + 1;
}

export async function spawnAgenticQueryRun(
  ctx: MutationCtx,
  params: {
    query: Doc<'chatroom_agenticQueries'>;
    workspace: Doc<'chatroom_workspaces'>;
    chatroomId: Id<'chatroom_rooms'>;
    userId: Id<'users'>;
    userMessage: string;
    turnSeq: number;
    priorTurns: { seq: number; userMessage: string; assistantResponse?: string }[];
    harness: AgenticHarnessSpawnConfig;
  }
): Promise<Id<'chatroom_agenticQueryRuns'>> {
  const now = Date.now();
  const cliCompleteCommand = `chatroom agentic-query complete --chatroom-id=${params.chatroomId} --query-id=${params.query._id}`;
  const envelope = renderAgenticQueryEnvelope({
    queryId: params.query._id,
    chatroomId: params.chatroomId,
    mode: params.query.mode,
    workspace: {
      machineId: params.workspace.machineId,
      workingDir: params.workspace.workingDir,
      hostname: params.workspace.hostname,
    },
    userMessage: params.userMessage,
    priorTurns: params.priorTurns,
    cliCompleteCommand,
  });

  const runId = await ctx.db.insert('chatroom_agenticQueryRuns', {
    type: 'opencode',
    agenticQueryId: params.query._id,
    turnSeq: params.turnSeq,
    workspaceId: params.workspace._id,
    status: 'pending',
    createdBy: params.userId,
    createdAt: now,
    lastActiveAt: now,
    opencode: {
      harnessName: params.harness.harnessName,
      opencodeSessionId: undefined,
      sessionTitle: params.query.title,
      lastUsedConfig: {
        agent: OPENCODE_AGENT,
        ...(params.harness.model ? { model: params.harness.model } : {}),
      },
    },
  });

  await insertAgenticQueryUserTurn(ctx, runId, envelope, now);
  return runId;
}
