/**
 * Command generator for handoff CLI command.
 *
 * Single source of truth for all handoff command examples and actual commands.
 *
 * Now uses stdin (HERE documents) instead of file-based approach.
 */

import type { HandoffParams } from '../../types/cli';
import {
  formatStdinHeredocCommand,
  HANDOFF_MESSAGE_MARKER,
  HANDOFF_STDIN_DELIMITER,
} from '../stdin-heredoc';

/**
 * Generate a handoff command string using stdin.
 * Returns a bash command that uses HERE document for message input.
 *
 * @example
 * // Command with placeholders
 * handoffCommand({ cliEnvPrefix: '' })
 * // → "chatroom handoff ... << 'CHATROOM_HANDOFF_END'\n---MESSAGE---\n[Your message here]\nCHATROOM_HANDOFF_END"
 *
 * @example
 * // Command with real values
 * handoffCommand({
 *   chatroomId: 'abc123',
 *   role: 'builder',
 *   nextRole: 'planner',
 * })
 * // → "chatroom handoff --chatroom-id=abc123 --role=builder --next-role=planner << 'CHATROOM_HANDOFF_END'\n[Your message here]\nCHATROOM_HANDOFF_END"
 */
export function handoffCommand(params: HandoffParams): string {
  const prefix = params.cliEnvPrefix || '';
  const chatroomId = params.chatroomId || '<chatroom-id>';
  const role = params.role || '<role>';
  const nextRole = params.nextRole || '<target>';
  const placeholder = params.messagePlaceholder ?? '[Your message here]';

  const commandPrefix = `${prefix}chatroom handoff --chatroom-id="${chatroomId}" --role="${role}" --next-role="${nextRole}"`;
  return formatStdinHeredocCommand(commandPrefix, HANDOFF_STDIN_DELIMITER, placeholder, {
    messageMarker: HANDOFF_MESSAGE_MARKER,
  });
}
