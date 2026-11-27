import { createInterface } from 'node:readline/promises';

import type { TransferPrompt } from './deps.js';

/**
 * Production prompt: stdin/stdout when both are a TTY.
 *
 * One readline interface per question, closed in `finally`, so an aborted or
 * failed prompt cannot leave stdin in raw mode. A non-interactive process
 * (piped input, CI) reports `false` instead of blocking on a hidden read.
 */
export function createTerminalPrompt(): TransferPrompt {
  return {
    isInteractive: () => Boolean(process.stdin.isTTY && process.stdout.isTTY),
    ask: async (question) => {
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      try {
        return await rl.question(question);
      } finally {
        rl.close();
      }
    },
  };
}
