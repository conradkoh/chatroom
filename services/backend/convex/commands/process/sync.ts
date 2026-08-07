import { ConvexError } from 'convex/values';
import type { MutationCtx } from '../../_generated/server';
import { MAX_COMMANDS_PER_SYNC } from '../types';

export async function syncCommands(
  ctx: MutationCtx,
  args: {
    machineId: string;
    workingDir: string;
    commands: Array<{
      name: string;
      script: string;
      source: 'package.json' | 'turbo.json' | 'deno.json' | 'Makefile';
      subWorkspace?: { type: string; path: string; name: string };
    }>;
  }
) {
  if (args.commands.length > MAX_COMMANDS_PER_SYNC) {
    throw new ConvexError(`Too many commands (max ${MAX_COMMANDS_PER_SYNC})`);
  }

  const existing = await ctx.db
    .query('chatroom_runnableCommands')
    .withIndex('by_machine_workingDir', (q) =>
      q.eq('machineId', args.machineId).eq('workingDir', args.workingDir)
    )
    .collect();

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
      subWorkspace: cmd.subWorkspace,
      syncedAt: now,
    });
  }
}
