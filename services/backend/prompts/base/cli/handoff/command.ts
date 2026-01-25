/**
 * Command generator for handoff CLI command.
 *
 * Single source of truth for all handoff command examples and actual commands.
 *
 * Now uses stdin (HERE documents) instead of file-based approach.
 */

import type { HandoffParams } from '../../../types/cli.js';

/**
 * Generate a handoff command string using stdin.
 * Returns a bash command that uses HERE document for message input.
 *
 * @example
 * // Command with placeholders
 * handoffCommand({ cliEnvPrefix: '' })
 * // → "chatroom handoff <chatroom-id> --role=<role> --next-role=<target> << 'EOF'\n[Your message here]\nEOF"
 *
 * @example
 * // Command with real values
 * handoffCommand({
 *   chatroomId: 'abc123',
 *   role: 'builder',
 *   nextRole: 'reviewer',
 * })
 * // → "chatroom handoff abc123 --role=builder --next-role=reviewer << 'EOF'\n[Your message here]\nEOF"
 */
export function handoffCommand(params: HandoffParams): string {
  const prefix = params.cliEnvPrefix || '';
  const chatroomId = params.chatroomId || '<chatroom-id>';
  const role = params.role || '<role>';
  const nextRole = params.nextRole || '<target>';

  // Modern approach: stdin using HERE document
  return `${prefix}chatroom handoff ${chatroomId} --role=${role} --next-role=${nextRole} << 'EOF'\n[Your message here]\nEOF`;
}
