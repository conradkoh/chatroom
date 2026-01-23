/**
 * Command generator for handoff CLI command.
 *
 * Single source of truth for all handoff command examples and actual commands.
 */

import type { HandoffParams } from '../../../types/cli.js';

/**
 * Generate a handoff command string.
 *
 * @example
 * // Example with placeholders
 * handoffCommand({ type: 'example' })
 * // → "chatroom handoff <chatroom-id> --role=<role> --message-file=<message-file> --next-role=<target>"
 *
 * @example
 * // Command with real values
 * handoffCommand({
 *   type: 'command',
 *   chatroomId: 'abc123',
 *   role: 'builder',
 *   nextRole: 'reviewer',
 *   messageFile: 'tmp/chatroom/message.md'
 * })
 * // → "chatroom handoff abc123 --role=builder --message-file=\"tmp/chatroom/message.md\" --next-role=reviewer"
 */
export function handoffCommand(params: HandoffParams): string {
  const prefix = params.cliEnvPrefix || '';

  if (params.type === 'example') {
    return `${prefix}chatroom handoff <chatroom-id> --role=<role> --message-file=<message-file> --next-role=<target>`;
  }

  // type === 'command'
  const { chatroomId, role, nextRole, messageFile } = params;

  const msgFileArg = messageFile
    ? `--message-file="${messageFile}"`
    : '--message-file=<message-file>';

  return `${prefix}chatroom handoff ${chatroomId} --role=${role} ${msgFileArg} --next-role=${nextRole}`;
}
