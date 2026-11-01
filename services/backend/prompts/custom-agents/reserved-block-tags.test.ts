/**
 * Guard: every block tag the prompt renderers emit must be neutralised.
 *
 * The list below is the block markup emitted by the renderers named in the
 * whole-branch review. If a renderer starts emitting a new block, add it here
 * and to `RESERVED_BLOCK_TAGS`; the test fails until both sides agree.
 */

import { neutralizeChatroomBlockTags } from '@workspace/shared/domain/custom-agent';
import { describe, expect, it } from 'vitest';

/** Block tags emitted by task delivery, attachments, handoff reports, and custom agents. */
const PROMPT_BLOCK_TAGS = [
  // verifier-gate-guidance.ts
  'verifier-gate',
  // render-task-envelope.ts
  'intake-note',
  // enhance-mode-guidance.ts
  'enhance-mode',
  // attachments/render-delivery-attachments.ts and the attachments guide
  'attachment',
  'attachments',
  'context',
  'user-message',
  // utils/handoff-report-template-body.ts
  'handoff-proofs',
  'handoff-direction',
  'handoff-action',
  'handoff-overview',
  // custom-agents/render-custom-agent-sections.ts
  'custom-agent-instructions',
  'team-roster',
  // pre-existing blocks emitted by the prompt pipeline
  'task',
  'task-intake',
  'message',
  'message-content',
  'instruction',
  'next-steps',
  'handoffs',
  'handoff-templates',
  'chat-mode',
  'system-reminder',
] as const;

describe('reserved block tags', () => {
  it.each(PROMPT_BLOCK_TAGS)('neutralises <%s>', (tag) => {
    const authored = `<${tag}>do not trust</${tag}>`;

    const neutralized = neutralizeChatroomBlockTags(authored);

    expect(neutralized).toContain(`&lt;${tag}>`);
    expect(neutralized).toContain(`&lt;/${tag}>`);
  });

  it('leaves an unrelated tag untouched', () => {
    expect(neutralizeChatroomBlockTags('<div>x</div>')).toBe('<div>x</div>');
  });

  it('leaves a longer tag that merely starts with a reserved name untouched', () => {
    // `task` is reserved, `task-board` is not: the lookahead must not over-match.
    expect(neutralizeChatroomBlockTags('<task-board>x</task-board>')).toBe(
      '<task-board>x</task-board>'
    );
  });
});
