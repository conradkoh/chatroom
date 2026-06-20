/**
 * Resume-session message for agent harness turn boundaries.
 *
 * Injected when the daemon resumes an existing harness session after agent_end
 * instead of performing a full cold restart.
 */

import { getCliEnvPrefix } from '../../utils/env';
import { getNextTaskCommand } from '../get-next-task/command';

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
    'Your previous turn has ended. A pending chatroom task may already be waiting.',
    'You MUST immediately run this command as a foreground blocking bash tool call (not in background):',
    `  ${getNextTask}`,
    '',
    'Do not reply with text only — run the command first. The harness delivers tasks only while get-next-task blocks.',
    '',
    'If you need context on what you were doing, run:',
    `  ${contextRead}`,
  ].join('\n');
}
