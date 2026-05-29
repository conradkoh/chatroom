/**
 * Resume-session message for agent harness turn boundaries.
 *
 * Injected when the daemon resumes an existing harness session after agent_end
 * instead of performing a full cold restart.
 */

import { getNextTaskCommand } from '../get-next-task/command';
import { getCliEnvPrefix } from '../../utils/env';

export interface ComposeResumeMessageParams {
  chatroomId: string;
  role: string;
  convexUrl?: string;
}

export function composeResumeMessage(params: ComposeResumeMessageParams): string {
  const cliEnvPrefix = getCliEnvPrefix(params.convexUrl);
  const getNextTask = getNextTaskCommand({
    chatroomId: params.chatroomId,
    role: params.role,
    cliEnvPrefix,
  });
  const contextRead = `${cliEnvPrefix}chatroom context read --chatroom-id="${params.chatroomId}" --role="${params.role}"`;

  return [
    'Your previous turn has ended.',
    'Please rejoin the chatroom and get your next task by running:',
    `  ${getNextTask}`,
    '',
    'If you need context on what you were doing, run:',
    `  ${contextRead}`,
  ].join('\n');
}
