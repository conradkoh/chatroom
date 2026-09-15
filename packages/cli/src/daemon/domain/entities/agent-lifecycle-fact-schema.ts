import { z } from 'zod';

import type { AgentLifecycleFact } from './agent-lifecycle-fact.js';

const revision = { revisionKey: z.string(), emittedAt: z.number() };
const agent = { ...revision, chatroomId: z.string(), role: z.string() };

/** Wire shape shared by new writes and recovery; Convex validates table IDs. */
export const agentLifecycleFactSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    ...agent,
    kind: z.literal('spawned'),
    pid: z.number(),
    model: z.string().optional(),
    reason: z.string().optional(),
    harnessSessionId: z.string().optional(),
  }),
  z.strictObject({
    ...agent,
    kind: z.literal('exited'),
    pid: z.number(),
    stopReason: z.string().optional(),
    stopSignal: z.string().optional(),
    exitCode: z.number().optional(),
    signal: z.string().optional(),
    agentHarness: z.string().optional(),
  }),
  z.strictObject({
    ...agent,
    kind: z.literal('activity'),
    action: z.string(),
    taskId: z.string().optional(),
  }),
  z.strictObject({
    ...agent,
    kind: z.literal('turn_failed'),
    taskId: z.string().optional(),
    harnessSessionId: z.string().optional(),
    turnId: z.string(),
    status: z.string(),
    source: z.string(),
    error: z.string().optional(),
  }),
  z.strictObject({
    ...agent,
    kind: z.literal('status'),
    status: z.enum(['offline', 'starting', 'waiting', 'working', 'stopping', 'error']),
    errorSource: z.enum(['configuration', 'runtime', 'task', 'enhancer', 'stop']).optional(),
    errorCode: z.string().optional(),
    errorMessage: z.string().optional(),
  }),
  z.strictObject({
    ...revision,
    kind: z.literal('chatroom_shutdown_complete'),
    chatroomId: z.string(),
    commandId: z.string(),
    finalizeChatroom: z.boolean().optional(),
  }),
  z.strictObject({ ...revision, kind: z.literal('cleared_all_pids') }),
]) satisfies z.ZodType<AgentLifecycleFact>;
