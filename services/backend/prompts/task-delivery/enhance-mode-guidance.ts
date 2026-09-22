import type { ConversationMode } from '@workspace/shared/domain/conversation-mode';

export function shouldIncludeEnhanceModeGuidance(params: {
  role: string;
  isEntryPoint?: boolean | undefined;
  senderRole?: string | undefined;
  conversationMode?: ConversationMode | undefined;
}): boolean {
  return (
    params.role.trim().toLowerCase() === 'planner' &&
    params.isEntryPoint === true &&
    params.senderRole?.trim().toLowerCase() === 'user' &&
    params.conversationMode === 'code:enhanced'
  );
}

export function appendEnhanceModeGuidance(lines: string[]): void {
  lines.push(
    '',
    '<enhance-mode>',
    '## Enhance Mode (Planner Design Authority)',
    '',
    '**Treat this planner task as the direct design authority before implementation or delegation.** Recover the authoritative user request and relevant history, then inspect repository evidence and established conventions.',
    '**Choose exactly one recommended design.** Cover the complete frontend and user flows, plus data, query, and mutation design when applicable. State the important risks, tests, and ordered implementation sequence before continuing the normal planner coordination and delegation workflow.',
    'If architect input is useful, delegate to `architect`; if UI/UX input is useful, delegate to `uiux-engineer`. Use the normal team handoff flow; do not create a separate design task or use a special handoff ceremony.',
    '</enhance-mode>'
  );
}
