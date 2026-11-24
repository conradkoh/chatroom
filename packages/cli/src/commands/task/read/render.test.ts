/**
 * renderTaskPrompt — unit tests
 *
 * The task-read renderer shows the task header, the user message body, and
 * the attachments block. It no longer renders pinned context, staleness, or
 * backlog-divergence sections.
 */

import { describe, expect, it } from 'vitest';

import { renderTaskPrompt, type RenderTaskPromptInput } from './render.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Full fixture: 2 backlog attachments (one diverging from no context at all) */
const ATTACHED_INPUT: RenderTaskPromptInput = {
  taskId: 'test-task-123',
  status: 'in_progress',
  content: 'Implement the login feature',
  chatroomId: 'test-chatroom-456',
  role: 'planner',
  attachedBacklogItems: [
    { _id: 'item-111', content: 'Add login page', status: 'pending' },
    { _id: 'item-333', content: 'Add logout', status: 'pending' },
  ],
};

/** Minimal fixture: no attachments */
const MINIMAL_INPUT: RenderTaskPromptInput = {
  taskId: 'test-task-789',
  status: 'in_progress',
  content: 'Fix the bug',
  chatroomId: 'test-chatroom-000',
  role: 'builder',
};

// =========================================================================
// Header and body
// =========================================================================

describe('header and body', () => {
  it('renders the task header, status, and body', () => {
    const output = renderTaskPrompt(MINIMAL_INPUT);
    expect(output).toContain('Task content');
    expect(output).toContain('test-task-789');
    expect(output).toContain('in_progress');
    expect(output).toContain('Fix the bug');
  });

  it('renders without crashing with a minimal input', () => {
    const output = renderTaskPrompt(MINIMAL_INPUT);
    expect(output).toContain('Fix the bug');
    expect(output).toContain('test-task-789');
  });
});

// =========================================================================
// Pinned context
// =========================================================================

describe('pinned context', () => {
  it('does not render pinned context, even when one is available', () => {
    const output = renderTaskPrompt({
      taskId: 'task-1',
      status: 'in_progress',
      content: 'Do the thing',
      chatroomId: 'room-1',
      role: 'builder',
    });
    expect(output).not.toContain('Background context');
    expect(output).not.toContain('<context>');
    expect(output).not.toContain('chatroom context read');
  });

  it('does not render precedence, divergence, or staleness notices', () => {
    const output = renderTaskPrompt(ATTACHED_INPUT);
    expect(output).not.toContain('message wins');
    expect(output).not.toContain('diverg');
    expect(output).not.toContain('system-notice');
  });
});

// =========================================================================
// Attachment hint
// =========================================================================

describe('attachment hint', () => {
  it('conveys that the task must be worked on', () => {
    const output = renderTaskPrompt(ATTACHED_INPUT);
    const hintSection = output.slice(
      output.indexOf('<attachment'),
      output.indexOf('</attachment>')
    );
    expect(hintSection).toMatch(/work on|act on/i);
  });

  it('includes the mark-for-review command', () => {
    const output = renderTaskPrompt(ATTACHED_INPUT);
    expect(output).toContain('mark-for-review');
  });
});

// =========================================================================
// Attachments
// =========================================================================

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
    expect(output).toContain('<attachment type="snippet" reference="attachment-reference-001">');
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
    expect(output).toContain('type="backlog"');
    expect(output).toContain('<attachment type="snippet" reference="attachment-reference-001">');
    expect(output).toContain('file-source="src/foo.ts"');
    expect(output.match(/<attachments>/g)?.length).toBe(1);
    expect(output.match(/<\/attachments>/g)?.length).toBe(1);
  });
});

describe('task and message attachments', () => {
  it('renders task attachment XML in attachments block', () => {
    const output = renderTaskPrompt({
      ...MINIMAL_INPUT,
      attachedTasks: [{ _id: 'task-abc123', content: 'Fix login redirect', status: 'backlog' }],
    });
    expect(output).toContain('<attachment type="task" task-id="task-abc123">');
    expect(output).toContain('<content>Fix login redirect</content>');
  });

  it('renders message attachment XML in attachments block', () => {
    const output = renderTaskPrompt({
      ...MINIMAL_INPUT,
      attachedMessages: [{ _id: 'msg-abc123', content: 'Prior discussion', senderRole: 'builder' }],
    });
    expect(output).toContain('<attachment type="message" message-id="msg-abc123">');
    expect(output).toContain('<sender-role>builder</sender-role>');
    expect(output).toContain('<content>Prior discussion</content>');
  });

  it('renders all four kinds in one attachments block', () => {
    const output = renderTaskPrompt({
      ...MINIMAL_INPUT,
      attachedBacklogItems: [{ _id: 'item-1', content: 'Backlog', status: 'pending' }],
      attachedSnippets: [{ reference: 'ref-1', fileSource: 'a.ts', selectedContent: 'x' }],
      attachedTasks: [{ _id: 'task-1', content: 'Task', status: 'backlog' }],
      attachedMessages: [{ _id: 'msg-1', content: 'Msg', senderRole: 'user' }],
    });
    expect(output.match(/<attachments>/g)?.length).toBe(1);
    expect(output).toContain('type="backlog"');
    expect(output).toContain('type="snippet"');
    expect(output).toContain('type="task"');
    expect(output).toContain('type="message"');
  });
});
