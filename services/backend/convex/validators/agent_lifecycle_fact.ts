import { v } from 'convex/values';

const spawnedFact = v.object({
  kind: v.literal('spawned'),
  chatroomId: v.id('chatroom_rooms'),
  role: v.string(),
  pid: v.number(),
  lifecycleRevision: v.optional(v.number()),
  model: v.optional(v.string()),
  reason: v.optional(v.string()),
  harnessSessionId: v.optional(v.string()),
  revisionKey: v.string(),
  emittedAt: v.number(),
});
const exitedFact = v.object({
  kind: v.literal('exited'),
  chatroomId: v.id('chatroom_rooms'),
  role: v.string(),
  pid: v.number(),
  stopReason: v.optional(v.string()),
  stopSignal: v.optional(v.string()),
  exitCode: v.optional(v.number()),
  signal: v.optional(v.string()),
  agentHarness: v.optional(v.string()),
  revisionKey: v.string(),
  emittedAt: v.number(),
});
const clearedAllPidsFact = v.object({
  kind: v.literal('cleared_all_pids'),
  revisionKey: v.string(),
  emittedAt: v.number(),
});
const activityFact = v.object({ kind: v.literal('activity'), chatroomId: v.id('chatroom_rooms'), role: v.string(), action: v.string(), taskId: v.optional(v.id('chatroom_tasks')), revisionKey: v.string(), emittedAt: v.number() });

export const agentLifecycleFactValidator = v.union(spawnedFact, exitedFact, clearedAllPidsFact, activityFact);
