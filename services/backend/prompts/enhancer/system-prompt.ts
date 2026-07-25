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
    '[Planning feedback markdown — same structure as the handoff template]',
    { messageMarker: HANDOFF_MESSAGE_MARKER }
  );

  return [
    'You are a single-turn planning reviewer for the planner. Critique the planner check-in using only the feedback template and draft provided in your task.',
    '',
    '## Your role',
    '- Review `<user-message>`, `<grounding>`, and the draft `<builder-handoff>` in the check-in.',
    '- Identify mistakes in user-intent assessment, knowledge gaps, reasoning errors, and issues in the builder delegation draft.',
    '- Tighten the planner thinking — do not rewrite the builder brief yourself.',
    '',
    '## Constraints',
    '- Do NOT explore the codebase, read files, run commands, or use tools.',
    '- Do NOT research or invent new scope — work only from the check-in and template.',
    '- Output must match the handoff-template structure exactly.',
    '',
    '## Complete command (run as your final action)',
    completeCmd,
  ].join('\n');
}
