/**
 * Utility for resolving content from inline strings or file paths.
 * Supports file-based input for CLI commands to avoid complex escape sequences.
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * Resolves content from either a direct string or a file path.
 *
 * @param content - Direct content string (inline option)
 * @param filePath - Path to file containing content (file option)
 * @param optionName - Name of the option (for error messages, e.g., 'message')
 * @returns The resolved content string, or undefined if neither provided
 * @throws Error if both options are provided, or if file cannot be read
 *
 * @example
 * // Using inline content
 * const msg = resolveContent('Hello world', undefined, 'message');
 *
 * @example
 * // Using file content
 * const msg = resolveContent(undefined, '/tmp/message.md', 'message');
 *
 * @example
 * // Error: both provided
 * resolveContent('inline', '/path/to/file', 'message'); // throws
 */
export function resolveContent(
  content: string | undefined,
  filePath: string | undefined,
  optionName: string
): string | undefined {
  // Both provided - error
  if (content && filePath) {
    throw new Error(`Cannot specify both --${optionName} and --${optionName}-file`);
  }

  // File path provided - read from file
  if (filePath) {
    const absolutePath = resolve(process.cwd(), filePath);
    try {
      return readFileSync(absolutePath, 'utf-8');
    } catch (err) {
      const nodeErr = err as NodeJS.ErrnoException;
      throw new Error(
        `Cannot read file for --${optionName}-file: ${absolutePath}\n` +
          `Reason: ${nodeErr.message}`
      );
    }
  }

  // Direct content or undefined
  return content;
}
