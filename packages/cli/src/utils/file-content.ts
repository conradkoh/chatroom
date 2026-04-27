/**
 * Utility for reading content from files for CLI commands.
 *
 * All content-heavy CLI options (--message-file, --description-file, etc.)
 * use file-based input to avoid complex escape sequences in bash commands.
 * This makes the CLI more accessible to AI models that struggle with escaping.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { NodeError } from '../infrastructure/types/node-error.js';

/**
 * Read content from a file.
 *
 * @param filePath - Path to file containing content (relative or absolute)
 * @param optionName - Name of the option (for error messages, e.g., 'message-file')
 * @returns The file content as a string
 * @throws Error if file cannot be read
 *
 * @example
 * const msg = readFileContent('/tmp/message.md', 'message-file');
 *
 * @example
 * // Relative paths are resolved from CWD
 * const msg = readFileContent('./handoff.md', 'message-file');
 */
export function readFileContent(filePath: string, optionName: string): string {
  const absolutePath = resolve(process.cwd(), filePath);
  try {
    return readFileSync(absolutePath, 'utf-8');
  } catch (err) {
    const nodeErr = err as NodeError;
    throw new Error(
      `Cannot read file for --${optionName}: ${absolutePath}\n` + `Reason: ${nodeErr.message}`
    );
  }
}
