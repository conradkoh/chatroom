/**
 * Shared utilities for prompt generation
 */

export const HANDOFF_DIR = 'tmp/chatroom';

/**
 * Generate handoff file snippet
 */
export function getHandoffFileSnippet(_purpose: string): string {
  return `tmp/chatroom/message-$(date +%s%N).md`;
}
