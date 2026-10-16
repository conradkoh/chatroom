// fallow-ignore-file unused-file
/**
 * Command generator for the notify-user CLI command.
 *
 * Single source of truth for all `chatroom notify-user` command examples and
 * actual commands, mirroring `cli/handoff/command.ts`.
 *
 * Uses stdin (HERE documents) because the notice body can be multi-line.
 */

import type { NotifyUserParams } from '../../types/cli';
import {
  formatStdinHeredocCommand,
  HANDOFF_MESSAGE_MARKER,
  NOTIFY_USER_STDIN_DELIMITER,
} from '../stdin-heredoc';

/**
 * Generate a `chatroom notify-user` command string using stdin.
 * Returns a bash command that uses a HERE document for the notice body.
 *
 * @example
 * // Command with placeholders
 * notifyUserCommand({ cliEnvPrefix: '' })
 * // → "chatroom notify-user --chatroom-id="<chatroom-id>" --role="<role>" << 'CHATROOM_NOTIFY_END'\n---MESSAGE---\n[Your update for the user]\nCHATROOM_NOTIFY_END"
 *
 * @example
 * // Command with real values
 * notifyUserCommand({ chatroomId: 'abc123', role: 'builder' })
 * // → "chatroom notify-user --chatroom-id="abc123" --role="builder" << 'CHATROOM_NOTIFY_END'\n---MESSAGE---\n[Your update for the user]\nCHATROOM_NOTIFY_END"
 */
// fallow-ignore-next-line complexity
export function notifyUserCommand(params: NotifyUserParams): string {
  const prefix = params.cliEnvPrefix || '';
  const chatroomId = params.chatroomId || '<chatroom-id>';
  const role = params.role || '<role>';
  const placeholder = params.messagePlaceholder ?? '[Your update for the user]';

  const commandPrefix = `${prefix}chatroom notify-user --chatroom-id="${chatroomId}" --role="${role}"`;
  return formatStdinHeredocCommand(commandPrefix, NOTIFY_USER_STDIN_DELIMITER, placeholder, {
    messageMarker: HANDOFF_MESSAGE_MARKER,
  });
}
