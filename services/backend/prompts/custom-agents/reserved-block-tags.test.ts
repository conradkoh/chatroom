/**
 * Guard: every block tag the prompt renderers emit must be neutralised.
 *
 * The list below is the block markup emitted by the renderers named in the
 * whole-branch review. If a renderer starts emitting a new block, add it here
 * and to `RESERVED_BLOCK_TAGS`; the test fails until both sides agree.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

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
  'snippet',
  'hint',
  'interactions',
  'interaction',
  'user-selected-content',
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

/**
 * Renderers whose emitted markup must stay reserved. Add a file here when it
 * starts emitting a chatroom block.
 */
const RENDERER_FILES = [
  'task-delivery/verifier-gate-guidance.ts',
  'task-delivery/render-task-envelope.ts',
  'task-delivery/enhance-mode-guidance.ts',
  'utils/handoff-report-template-body.ts',
  'attachments/render-delivery-attachments.ts',
] as const;

/** Tags the renderers only mention as fill-in placeholders, never as markup. */
const PLACEHOLDER_TAGS = ['requirement', 'reason'] as const;

/**
 * Every tag name a source mentions, with or without attributes. Matching only
 * `<tag>` would let an attributed block such as `<foo type="x">` slip past the
 * guard; the optional group therefore requires an `=` before `>`, which is what
 * separates markup from the prose placeholders the templates use
 * (`<current state after this work>`, `<additional files as needed>`).
 */
function tagsIn(source: string): string[] {
  const found = new Set<string>();
  for (const match of source.matchAll(/<\/?([a-z][a-z0-9-]*)(?:\s[^<>]*=[^<>]*)?\/?>/g)) {
    found.add(match[1]!);
  }
  return [...found].sort();
}

/** Every tag a renderer source mentions. */
function tagsInRendererSource(): string[] {
  const found = new Set<string>();
  for (const file of RENDERER_FILES) {
    const source = readFileSync(join(__dirname, '..', file), 'utf8');
    for (const tag of tagsIn(source)) found.add(tag);
  }
  return [...found].sort();
}

describe('reserved block tags', () => {
  it('reserves every tag the prompt renderers emit', () => {
    const emitted = tagsInRendererSource().filter(
      (tag) => !(PLACEHOLDER_TAGS as readonly string[]).includes(tag)
    );

    expect(emitted.length).toBeGreaterThan(0);
    for (const tag of emitted) {
      expect(neutralizeChatroomBlockTags(`<${tag}>x</${tag}>`)).toContain(`&lt;${tag}>`);
    }
  });

  it('catches a tag that carries attributes', () => {
    // Matching only `<tag>` would let `<foo type="x">` through the guard.
    expect(tagsIn('<foo type="x">value</foo>')).toEqual(['foo']);
    expect(tagsIn('<bar/>')).toEqual(['bar']);
  });

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
