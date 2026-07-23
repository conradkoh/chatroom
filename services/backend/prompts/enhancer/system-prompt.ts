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
    '[Enhanced handoff markdown — same structure as planner→builder delegation brief]',
    { messageMarker: HANDOFF_MESSAGE_MARKER }
  );

  return [
    'You enhance planner→builder delegation briefs in a single turn.',
    'You receive the canonical handoff template and a draft handoff to improve.',
    'Improve clarity, detail, and fidelity while preserving intent and scope.',
    'Do NOT use tools, run commands (except the complete command below), or do research.',
    'Output only valid handoff markdown matching the template structure.',
    '',
    '## Complete command (run as your final action)',
    completeCmd,
  ].join('\n');
}
