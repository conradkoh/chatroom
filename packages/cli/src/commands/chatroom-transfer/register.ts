/**
 * Commander registration for `chatroom export` and `chatroom import`.
 *
 * `src/index.ts` parses argv at import time, so this module exports the
 * registration function instead of registering as a side effect. Tests build a
 * program, register these commands with an injected `makeDeps`, and exercise the
 * parsed argv, the port, the driver and the real publisher/import end to end.
 */

import type { Command } from 'commander';

import type { ChatroomTransferDeps } from './deps.js';
import { exportChatroom, formatTransferError, type ExportOptions } from './export.js';
import { createNodeChatroomTransferFs } from './file-io.js';
import { importChatroom, type ImportOptions } from './import.js';
import { createTerminalPrompt } from './transfer-prompt.js';
import { createConvexCommandDeps } from '../../infrastructure/deps/create-convex-command-deps.js';
import { getVersion } from '../../version.js';

/** The production dependency graph: Convex client, machine identity and real file system. */
async function createChatroomTransferDeps(): Promise<ChatroomTransferDeps> {
  // Machine identity detection loads the harness registry, which pulls in the
  // daemon and `node:sqlite`. Import it lazily so registering the commands does
  // not make every CLI invocation load that graph.
  const { getMachineId } = await import('../../infrastructure/machine/storage.js');
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
    signals: {
      on: (signal, handler) => {
        process.on(signal, handler);
      },
      off: (signal, handler) => {
        process.off(signal, handler);
      },
    },
    prompt: createTerminalPrompt(),
  };
}

/**
 * Registers the transfer commands on `program`.
 *
 * `export` authenticates first. `import` hands `requireAuth` to the command body,
 * which calls it only after listing and selection, so `--list` works logged out.
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
      'Export one chatroom (--chatroom-id) or every chatroom you own on this machine (--all) to JSON files. --all writes ONE bundle file. The files are plaintext and contain conversation content; keep them private.'
    )
    .option('--chatroom-id <id>', 'Chatroom identifier (exclusive with --all)')
    .option('--all', 'Export every chatroom you own that has an active workspace on this machine')
    .option('--path <dir>', 'Directory to write to (default: .chatroom/exports/)')
    .action(async (opts: ExportOptions) => {
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

  program
    .command('import')
    .description(
      'Import chatrooms from an export file as NEW chatrooms owned by you. Listing the file needs no login. Importing needs a login and an owned target machine. Never merges; importing twice creates two chatrooms. Starts no agents.'
    )
    .option('--machine-id <id>', 'Machine to bind workspaces to (default: this machine)')
    .option('--dry-run', 'Validate and print the plan; write nothing')
    .option(
      '--select <all|id[,id...]>',
      'Chatrooms to import from a bundle: all, or positions/source ids separated by commas. Without it, a terminal prompts.'
    )
    .option(
      '--list',
      'Print the chatrooms in the file and exit. Needs no login and writes nothing.'
    )
    .requiredOption('--path <file>', 'Export file to import')
    .action(async (opts: ImportOptions) => {
      const deps = await makeDeps();
      try {
        await importChatroom(opts, deps, { ensureAuth: requireAuth });
      } catch (error) {
        const formatted = formatTransferError(error);
        deps.err(`❌ [${formatted.code}] ${formatted.message}`);
        deps.exit(1);
      }
    });
}
