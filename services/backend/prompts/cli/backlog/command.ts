/**
 * Command generators for backlog CLI stdin examples.
 */

import type { CommandContext } from '../../types/cli';
import { BACKLOG_STDIN_DELIMITER, formatStdinHeredocCommand } from '../stdin-heredoc';

export interface BacklogContentCommandParams extends CommandContext {
  chatroomId?: string;
  role?: string;
  backlogItemId?: string;
  contentPlaceholder?: string;
}

// fallow-ignore-next-line complexity
export function backlogAddCommand(params: BacklogContentCommandParams): string {
  const prefix = params.cliEnvPrefix || '';
  const chatroomId = params.chatroomId || '<id>';
  const role = params.role || '<role>';
  const placeholder = params.contentPlaceholder ?? 'Your backlog item content here';
  const commandPrefix = `${prefix}chatroom backlog add --chatroom-id=${chatroomId} --role=${role}`;
  return formatStdinHeredocCommand(commandPrefix, BACKLOG_STDIN_DELIMITER, placeholder);
}

// fallow-ignore-next-line complexity
export function backlogUpdateCommand(params: BacklogContentCommandParams): string {
  const prefix = params.cliEnvPrefix || '';
  const chatroomId = params.chatroomId || '<id>';
  const role = params.role || '<role>';
  const backlogItemId = params.backlogItemId || '<id>';
  const placeholder = params.contentPlaceholder ?? 'New content here';
  const commandPrefix = `${prefix}chatroom backlog update --chatroom-id=${chatroomId} --role=${role} --backlog-item-id=${backlogItemId}`;
  return formatStdinHeredocCommand(commandPrefix, BACKLOG_STDIN_DELIMITER, placeholder);
}
