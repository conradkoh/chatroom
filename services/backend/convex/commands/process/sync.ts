import { ConvexError } from 'convex/values';

import type { Doc } from '../../_generated/dataModel';
import type { MutationCtx } from '../../_generated/server';
import { MAX_COMMANDS_PER_SYNC } from '../types';

type SyncCommandsArgs = {
  machineId: string;
  workingDir: string;
  commands: {
    name: string;
    script: string;
    source: 'package.json' | 'turbo.json' | 'deno.json' | 'Makefile';
    subWorkspace?: { type: string; path: string; name: string };
  }[];
};

/**
 * Identity of a runnable command for change detection. Positional fields (not object
 * serialization) keep the key independent of object key order.
 */
function commandKey(cmd: {
  name: string;
  script: string;
  source: string;
  subWorkspace?: { type: string; path: string; name: string } | undefined;
}): string {
  const sub = cmd.subWorkspace;
  return JSON.stringify([
    cmd.source,
    cmd.name,
    cmd.script,
    sub ? [sub.type, sub.path, sub.name] : null,
  ]);
}

/** True when the incoming command set matches the stored set exactly (as a multiset). */
function isSameCommandSet(
  existing: Doc<'chatroom_runnableCommands'>[],
  incoming: SyncCommandsArgs['commands']
): boolean {
  const incomingKeys = incoming.map(commandKey).sort();
  const existingKeys = existing.map(commandKey).sort();
  return (
    incomingKeys.length === existingKeys.length &&
    incomingKeys.every((key, index) => key === existingKeys[index])
  );
}

async function replaceCommands(
  ctx: MutationCtx,
  args: SyncCommandsArgs,
  existing: Doc<'chatroom_runnableCommands'>[]
) {
  for (const cmd of existing) {
    await ctx.db.delete('chatroom_runnableCommands', cmd._id);
  }

  const now = Date.now();
  for (const cmd of args.commands) {
    await ctx.db.insert('chatroom_runnableCommands', {
      machineId: args.machineId,
      workingDir: args.workingDir,
      name: cmd.name,
      script: cmd.script,
      source: cmd.source,
      ...(cmd.subWorkspace !== undefined ? { subWorkspace: cmd.subWorkspace } : {}),
      syncedAt: now,
    });
  }
}

export async function syncCommands(ctx: MutationCtx, args: SyncCommandsArgs) {
  if (args.commands.length > MAX_COMMANDS_PER_SYNC) {
    throw new ConvexError(`Too many commands (max ${MAX_COMMANDS_PER_SYNC})`);
  }

  const existing = await ctx.db
    .query('chatroom_runnableCommands')
    .withIndex('by_machine_workingDir', (q) =>
      q.eq('machineId', args.machineId).eq('workingDir', args.workingDir)
    )
    .collect();

  // No-op guard: an identical command set leaves rows (and their syncedAt) untouched.
  if (isSameCommandSet(existing, args.commands)) return;

  await replaceCommands(ctx, args, existing);
}
