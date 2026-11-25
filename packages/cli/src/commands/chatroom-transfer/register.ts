/**
 * Commander registration for `chatroom export` (and, in a later phase, `import`).
 *
 * `src/index.ts` parses argv at import time, so this module exports the
 * registration function instead of registering as a side effect. Tests build a
 * program, register this command with an injected `makeDeps`, and exercise the
 * parsed argv, the port, the driver and the real publisher end to end.
 *
 * Only `export` is registered here. The wiring into `src/index.ts` lands with
 * the import command, which is why this file is currently the dead-code
 * baseline's P9 removal point.
 */

import type { Command } from 'commander';

import type { ChatroomTransferDeps } from './deps.js';
import { exportChatroom, formatTransferError } from './export.js';
import { createNodeChatroomTransferFs } from './file-io.js';
import { createConvexCommandDeps } from '../../infrastructure/deps/create-convex-command-deps.js';
import { getMachineId } from '../../infrastructure/machine/storage.js';
import { getVersion } from '../../version.js';

/** The production dependency graph: Convex client, machine identity and real file system. */
export async function createChatroomTransferDeps(): Promise<ChatroomTransferDeps> {
  const { backend, session } = await createConvexCommandDeps();
  return {
    backend,
    session,
    machine: { getMachineId },
    fs: createNodeChatroomTransferFs(),
    clock: () => new Date(),
    version: getVersion(),
    cwd: () => process.cwd(),
    out: (line) => console.log(line),
    err: (line) => console.error(line),
    exit: (code) => process.exit(code),
  };
}

/**
 * Registers the transfer commands on `program`.
 *
 * `requireAuth` runs before deps are built, matching the other command groups.
 * `makeDeps` is the test seam; production passes the default factory.
 */
export function registerChatroomTransferCommands(
  program: Command,
  requireAuth: () => Promise<void>,
  makeDeps: () => Promise<ChatroomTransferDeps> = createChatroomTransferDeps
): void {
  program
    .command('export')
    .description(
      'Export one chatroom (content and configuration) to a JSON file. The file is plaintext and contains conversation content; keep it private.'
    )
    .requiredOption('--chatroom-id <id>', 'Chatroom identifier')
    .option('--path <dir>', 'Directory to write to (default: .chatroom/exports/)')
    .action(async (opts: { chatroomId: string; path?: string | undefined }) => {
      await requireAuth();
      const deps = await makeDeps();
      try {
        await exportChatroom(opts, deps);
      } catch (error) {
        const formatted = formatTransferError(error);
        deps.err(`❌ [${formatted.code}] ${formatted.message}`);
        deps.exit(1);
      }
    });
}
