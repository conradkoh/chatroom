/**
 * Shared utilities for prompt generation
 */

export const HANDOFF_DIR = 'tmp/chatroom';

/**
 * Generate a unique file path for handoff or other temporary files.
 * Uses a bash variable to ensure the same filename is used consistently.
 *
 * @param prefix - The file prefix (e.g., 'handoff', 'description', 'techSpecs')
 * @param options - Optional configuration
 * @returns An object with the bash variable name and file path expression
 *
 * @example
 * generateFilename('handoff', { type: 'md' })
 * // Returns: { varName: 'HANDOFF_FILE', filePath: 'tmp/chatroom/handoff-$HANDOFF_FILE.md' }
 */
export function generateFilename(
  prefix: string,
  options: { type?: string } = {}
): { varName: string; filePath: string } {
  const extension = options.type || 'md';
  const varName = `${prefix.toUpperCase()}_FILE`;
  const filePath = `${HANDOFF_DIR}/${prefix}-\${${varName}}.${extension}`;
  return { varName, filePath };
}

/**
 * Generate handoff file snippet (legacy - use generateFilename instead)
 * @deprecated Use generateFilename('message', { type: 'md' }) instead
 */
export function getHandoffFileSnippet(_purpose: string): string {
  const { filePath } = generateFilename('message', { type: 'md' });
  return filePath;
}
