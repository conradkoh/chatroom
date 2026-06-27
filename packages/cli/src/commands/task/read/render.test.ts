/**
 * renderTaskPrompt — unit tests
 *
 * Tests-first approach: these tests describe the NEW desired shape.
 * They FAIL against the extracted-but-unchanged renderer and will
 * pass after the implementation step (step 4).
 */

import { describe, expect, it } from 'vitest';

import { renderTaskPrompt, type RenderTaskPromptInput } from './render.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Full fixture: context + trigger message + 2 attachments (one diverging) */
const FULL_INPUT: RenderTaskPromptInput = {
  taskId: 'test-task-123',
  status: 'in_progress',
  content: 'Implement the login feature',
  chatroomId: 'test-chatroom-456',
  role: 'planner',
  context: {
    content: 'We are building a chat app. Backlog: item-111, item-222.',
    triggerMessageContent: 'Please add login',
    triggerMessageSenderRole: 'user',
    elapsedHours: 2,
  },
  attachedBacklogItems: [
    { _id: 'item-111', content: 'Add login page', status: 'pending' },
    { _id: 'item-333', content: 'Add logout', status: 'pending' },
  ],
};

/** Minimal fixture: no context, no attachments */
const MINIMAL_INPUT: RenderTaskPromptInput = {
  taskId: 'test-task-789',
  status: 'in_progress',
  content: 'Fix the bug',
  chatroomId: 'test-chatroom-000',
  role: 'builder',
};

/** Stale context fixture */
const STALE_INPUT: RenderTaskPromptInput = {
  taskId: 'test-task-stale',
  status: 'in_progress',
  content: 'Fix performance',
  chatroomId: 'test-chatroom-stale',
  role: 'planner',
  context: {
    content: 'Old context here.',
    elapsedHours: 50,
  },
};

/**
 * Golden output from the current (unchanged) renderer.
 * Captured manually — used for the size-constraint assertion.
 * DO NOT update without verifying against the actual renderer output.
 */
const OLD_GOLDEN_LENGTH = 988;

// =========================================================================
// Layout
// =========================================================================

describe('layout', () => {
  it('renders user message body BEFORE pinned context when both are present', () => {
    const output = renderTaskPrompt(FULL_INPUT);
    const bodyIdx = output.indexOf(FULL_INPUT.content);
    const contextIdx = output.indexOf('Background context');
    expect(bodyIdx).toBeLessThan(contextIdx);
  });

  it('renders attachments BEFORE pinned context when both are present', () => {
    const output = renderTaskPrompt(FULL_INPUT);
    const attachmentsIdx = output.indexOf('<attachments>');
    const contextIdx = output.indexOf('Background context');
    expect(attachmentsIdx).toBeLessThan(contextIdx);
  });
});

// =========================================================================
// Context label
// =========================================================================

describe('context label', () => {
  it('uses demoted label "Background context (may be stale)"', () => {
    const output = renderTaskPrompt(FULL_INPUT);
    expect(output).toContain('Background context');
    expect(output).toContain('may be stale');
  });

  it('does NOT contain the old "PINNED CONTEXT" header', () => {
    const output = renderTaskPrompt(FULL_INPUT);
    expect(output).not.toContain('PINNED CONTEXT');
  });
});

// =========================================================================
// Precedence line
// =========================================================================

describe('precedence line', () => {
  it('includes a precedence line near the top stating user message wins', () => {
    const output = renderTaskPrompt(FULL_INPUT);
    expect(output).toContain('message wins');
    expect(output).toContain('conflict');
  });

  it('appears only once', () => {
    const output = renderTaskPrompt(FULL_INPUT);
    const matches = output.match(/On conflict, the message wins over background context\./g);
    expect(matches?.length ?? 0).toBeGreaterThanOrEqual(1);
    expect(matches?.length ?? 0).toBeLessThanOrEqual(1);
  });
});

// =========================================================================
// Attachment hint
// =========================================================================

describe('attachment hint', () => {
  it('conveys that the task must be worked on', () => {
    const output = renderTaskPrompt(FULL_INPUT);
    const hintSection = output.slice(
      output.indexOf('<attachment'),
      output.indexOf('</attachment>')
    );
    expect(hintSection).toMatch(/work on|act on/i);
  });

  it('includes the mark-for-review command', () => {
    const output = renderTaskPrompt(FULL_INPUT);
    expect(output).toContain('mark-for-review');
  });
});

// =========================================================================
// Divergence warning
// =========================================================================

describe('divergence warning', () => {
  it('emits a warning when attached backlog ID is not in context content', () => {
    const output = renderTaskPrompt(FULL_INPUT);
    // item-333 is not in context content (which has item-111, item-222)
    expect(output).toContain('item-333');
    expect(output).toContain('diverg');
  });

  it('does NOT emit a warning when attached ID IS in context content', () => {
    const input: RenderTaskPromptInput = {
      ...FULL_INPUT,
      attachedBacklogItems: [{ _id: 'item-111', content: 'Add login page', status: 'pending' }],
    };
    const output = renderTaskPrompt(input);
    expect(output).not.toContain('diverg');
  });

  it('does NOT emit a warning when no context is present', () => {
    const output = renderTaskPrompt(MINIMAL_INPUT);
    expect(output).not.toContain('diverg');
  });
});

// =========================================================================
// Net size constraint
// =========================================================================

describe('net size', () => {
  it('does NOT increase prompt length for the full fixture', () => {
    const output = renderTaskPrompt(FULL_INPUT);
    expect(output.length).toBeLessThanOrEqual(OLD_GOLDEN_LENGTH);
  });
});

// =========================================================================
// Minimal input
// =========================================================================

describe('minimal input', () => {
  it('renders without crashing', () => {
    const output = renderTaskPrompt(MINIMAL_INPUT);
    expect(output).toContain('Fix the bug');
    expect(output).toContain('test-task-789');
  });
});

// =========================================================================
// Stale context
// =========================================================================

describe('stale context', () => {
  it('still renders staleness notice', () => {
    const output = renderTaskPrompt(STALE_INPUT);
    expect(output).toContain('old');
  });
});

// =========================================================================
// Originating message disclosure
// =========================================================================

describe('originating message disclosure', () => {
  it('does NOT inline the originating message or the "in response to" block', () => {
    const output = renderTaskPrompt(FULL_INPUT);
    expect(output).not.toContain('in response to');
    expect(output).not.toContain('Please add login');
  });

  it('discloses the context read command instead', () => {
    const output = renderTaskPrompt(FULL_INPUT);
    expect(output).toContain('chatroom context read');
  });
});

describe('snippet attachments', () => {
  it('renders snippet XML in attachments block after plain content', () => {
    const output = renderTaskPrompt({
      ...MINIMAL_INPUT,
      content: 'What library is [attachment: attachment-reference-001]?',
      attachedSnippets: [
        {
          reference: 'attachment-reference-001',
          fileSource: './windsurfrules',
          selectedContent: '# Shadcn',
        },
      ],
    });
    const contentIdx = output.indexOf('What library is');
    const attachmentsIdx = output.indexOf('<attachments>');
    expect(contentIdx).toBeLessThan(attachmentsIdx);
    expect(output).toContain('<attachment reference="attachment-reference-001">');
    expect(output).toContain('file-source="./windsurfrules"');
    expect(output).toContain('# Shadcn');
    expect(output).not.toContain('<message>');
  });

  it('renders backlog and snippet attachments in same block', () => {
    const output = renderTaskPrompt({
      ...MINIMAL_INPUT,
      content: 'Work on both',
      attachedBacklogItems: [{ _id: 'item-111', content: 'Backlog task', status: 'pending' }],
      attachedSnippets: [
        {
          reference: 'attachment-reference-001',
          fileSource: 'src/foo.ts',
          selectedContent: 'const x = 1;',
        },
      ],
    });
    expect(output).toContain('<attachments>');
    expect(output).toContain('type="backlog-item"');
    expect(output).toContain('<attachment reference="attachment-reference-001">');
    expect(output).toContain('file-source="src/foo.ts"');
    expect(output.match(/<attachments>/g)?.length).toBe(1);
    expect(output.match(/<\/attachments>/g)?.length).toBe(1);
  });
});
