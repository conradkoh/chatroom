/**
 * Command generator for handoff CLI command.
 *
 * Single source of truth for all handoff command examples and actual commands.
 */

import type { HandoffParams } from '../../../types/cli.js';

/**
 * Generate a handoff command string.
 * Accepts optional values and uses placeholders for any missing values.
 *
 * @example
 * // Command with placeholders
 * handoffCommand({})
 * // → "chatroom handoff <chatroom-id> --role=<role> --message-file=<message-file> --next-role=<target>"
 *
 * @example
 * // Command with real values
 * handoffCommand({
 *   chatroomId: 'abc123',
 *   role: 'builder',
 *   nextRole: 'reviewer',
 *   messageFile: 'tmp/chatroom/message.md'
 * })
 * // → "chatroom handoff abc123 --role=builder --message-file=\"tmp/chatroom/message.md\" --next-role=reviewer"
 *
 * @example
 * // Command with mix of values and placeholders
 * handoffCommand({
 *   chatroomId: 'abc123',
 *   role: 'builder',
 *   nextRole: '<target>',
 * })
 * // → "chatroom handoff abc123 --role=builder --message-file=<message-file> --next-role=<target>"
 */
export function handoffCommand(params: HandoffParams = {}): string {
  const prefix = params.cliEnvPrefix || '';
  const chatroomId = params.chatroomId || '<chatroom-id>';
  const role = params.role || '<role>';
  const nextRole = params.nextRole || '<target>';
  const messageFile = params.messageFile || '<message-file>';

  const msgFileArg = params.messageFile
    ? `--message-file="${messageFile}"`
    : `--message-file=${messageFile}`;

  return `${prefix}chatroom handoff ${chatroomId} --role=${role} ${msgFileArg} --next-role=${nextRole}`;
}
