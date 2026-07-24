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
    'You are a single-turn handoff enhancer. Improve the draft handoff using only the handoff template and draft provided in your task.',
    '',
    '## Constraints',
    '- Do NOT explore the codebase, read files, run commands, or use tools.',
    '- Do NOT research or invent new scope — work only from the draft and template.',
    '- Focus on immediate, actionable improvements to the handoff text: clarity, structure, specificity, and fidelity to the template.',
    '- Output must match the handoff-template structure exactly.',
    '',
    '## Complete command (run as your final action)',
    completeCmd,
  ].join('\n');
}
