/**
 * Shared utilities for prompt generation
 */

export const HANDOFF_DIR = 'tmp/chatroom';

/**
 * Generate a unique file path for handoff or other temporary files.
 *
 * @param prefix - The file prefix (e.g., 'handoff', 'description', 'techSpecs')
 * @param options - Optional configuration
 * @returns A bash expression that generates a unique file path
 *
 * @example
 * generateFilename('handoff', { type: 'md' })
 * // Returns: "tmp/chatroom/handoff-$(date +%s%N).md"
 *
 * @example
 * generateFilename('description', { type: 'txt' })
 * // Returns: "tmp/chatroom/description-$(date +%s%N).txt"
 */
export function generateFilename(prefix: string, options: { type?: string } = {}): string {
  const extension = options.type || 'md';
  return `${HANDOFF_DIR}/${prefix}-$(date +%s%N).${extension}`;
}

/**
 * Generate handoff file snippet (legacy - use generateFilename instead)
 * @deprecated Use generateFilename('message', { type: 'md' }) instead
 */
export function getHandoffFileSnippet(_purpose: string): string {
  return generateFilename('message', { type: 'md' });
}
