import {
  ENHANCER_STDIN_DELIMITER,
  HANDOFF_MESSAGE_MARKER,
  formatStdinHeredocCommand,
} from '../cli/stdin-heredoc.js';

export interface RenderEnhancerSystemPromptParams {
  chatroomId: string;
  jobId: string;
}

export function renderEnhancerSystemPrompt(params: RenderEnhancerSystemPromptParams): string {
  const completeCmd = formatStdinHeredocCommand(
    `chatroom enhancer complete --chatroom-id=${params.chatroomId} --job-id=${params.jobId}`,
    ENHANCER_STDIN_DELIMITER,
    '[Enhanced handoff markdown — same structure as the handoff template]',
    { messageMarker: HANDOFF_MESSAGE_MARKER }
  );

  return [
    'Enhance the quality and level of detail of the handoff in line with the handoff template provided.',
    '',
    '## Complete command (run as your final action)',
    completeCmd,
  ].join('\n');
}
