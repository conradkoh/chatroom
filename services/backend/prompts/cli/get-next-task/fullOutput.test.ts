import { describe, expect, test } from 'vitest';

import { generateFullCliOutput } from './fullOutput';

const BASE_PARAMS = {
  chatroomId: 'test-chatroom-id',
  role: 'builder',
  cliEnvPrefix: 'CHATROOM_CONVEX_URL=http://127.0.0.1:3210 ',
  task: {
    _id: 'test-task-id',
    content: 'Implement the feature',
  },
  message: {
    _id: 'test-message-id',
    senderRole: 'planner',
    content: 'Please implement',
  },
  currentContext: null,
  originMessage: {
    senderRole: 'user',
    content: 'Please implement',
    classification: 'new_feature',
  },
  followUpCountSinceOrigin: 0,
  originMessageCreatedAt: null,
  isEntryPoint: false,
  availableHandoffTargets: ['planner'],
};

describe('generateFullCliOutput — nativeIntegration', () => {
  test('native mode includes context staleness warnings like CLI', () => {
    const output = generateFullCliOutput({
      ...BASE_PARAMS,
      teamId: 'duo',
      role: 'planner',
      isEntryPoint: true,
      nativeIntegration: true,
      currentContext: { content: 'Old focus', elapsedHours: 30 },
    });

    expect(output).toContain('## Context');
    expect(output).toContain('⚠️ Context is 1d old.');
    expect(output).toContain('context read --chatroom-id="test-chatroom-id"');
  });

  test('native mode returns task content, eager templates, next steps, and handoff commands', () => {
    const output = generateFullCliOutput({
      ...BASE_PARAMS,
      teamId: 'duo',
      nativeIntegration: true,
    });

    expect(output).not.toContain('get-next-task');
    expect(output).toContain('<task>');
    expect(output).toContain('Implement the feature');
    expect(output).toContain('<next-steps>');
    expect(output).toContain('you MUST run the handoff command');
    expect(output).toContain('<handoffs>');
    expect(output).toContain('**planner**');
    expect(output).not.toContain('task injection');
    expect(output).not.toMatch(/task read --chatroom-id/i);
    expect(output).toContain('<handoff-templates>');
    expect(output).toContain('Handoff Template (Builder → Planner)');
    expect(output).not.toContain('handoff view-template');
  });

  test('CLI mode includes handoff-templates and handoffs sections', () => {
    const output = generateFullCliOutput({
      ...BASE_PARAMS,
      teamId: 'duo',
      nativeIntegration: false,
    });

    expect(output).toContain('<handoff-templates>');
    expect(output).toContain('<handoffs>');
    expect(output).toContain('you MUST run the handoff command');
    expect(output).not.toContain('Delegate ONE slice to the builder');
    expect(output).toContain('get-next-task'); // footer preserved
  });

  test('CLI planner user message has eager templates in handoff-templates section', () => {
    const output = generateFullCliOutput({
      ...BASE_PARAMS,
      role: 'planner',
      teamId: 'duo',
      isEntryPoint: true,
      message: { _id: 'msg-id', senderRole: 'user', content: 'hello' },
      availableHandoffTargets: ['builder', 'user'],
      nativeIntegration: false,
      task: { _id: 'task-id', content: 'hello' },
    });
    expect(output).toContain('Report Template (Planner → User)');
    expect(output).toContain('Delegation Brief (Planner → Builder)');
    // Templates should be in handoff-templates, not inline in next-steps
    const nextSteps = output.slice(output.indexOf('<next-steps>'), output.indexOf('</next-steps>'));
    expect(nextSteps).not.toContain('## Proof of Principle');
  });

  test('CLI mode includes inline task content and get-next-task reminder', () => {
    const output = generateFullCliOutput({
      ...BASE_PARAMS,
      nativeIntegration: false,
    });

    expect(output).toContain('get-next-task');
    expect(output).toContain('Implement the feature');
    expect(output).toContain('grace-period cooldowns');
    expect(output).toContain('<handoffs>');
    expect(output).not.toMatch(/task read --chatroom-id/i);
  });

  test('native planner user message lists handoff targets and eager templates', () => {
    const output = generateFullCliOutput({
      ...BASE_PARAMS,
      role: 'planner',
      teamId: 'duo',
      isEntryPoint: true,
      message: { _id: 'msg-id', senderRole: 'user', content: 'hello' },
      availableHandoffTargets: ['builder', 'user'],
      nativeIntegration: true,
      task: { _id: 'task-id', content: 'hello' },
    });

    expect(output).toContain('hello');
    expect(output).toContain('<next-steps>');
    expect(output).toContain('--next-role="user"');
    expect(output).toContain('**user**');
    expect(output).toContain('**builder**');
    expect(output).toContain('<handoff-templates>');
    expect(output).toContain('Report Template (Planner → User)');
    expect(output).toContain('Delegation Brief (Planner → Builder)');
    expect(output).not.toContain('Classify');
  });
});

describe('generateFullCliOutput — snippet attachments in primary delivery', () => {
  test('CLI mode includes backlog XML after task content when sourceAttachments has backlog items', () => {
    const output = generateFullCliOutput({
      ...BASE_PARAMS,
      nativeIntegration: false,
      sourceAttachments: {
        attachedBacklogItems: [
          {
            _id: 'backlog-item-001',
            status: 'backlog',
            content: 'Implement dark mode toggle',
          },
        ],
      },
    });
    const taskContentIdx = output.indexOf('Implement the feature');
    const attachmentsIdx = output.indexOf('<attachments>');
    expect(attachmentsIdx).toBeGreaterThan(taskContentIdx);
    expect(output).toContain('type="backlog-item"');
    expect(output).toContain('Implement dark mode toggle');
    expect(output).toContain('backlog-item-001');
  });

  test('CLI mode includes snippet XML after task content when sourceAttachments has snippets', () => {
    const output = generateFullCliOutput({
      ...BASE_PARAMS,
      nativeIntegration: false,
      sourceAttachments: {
        attachedSnippets: [
          {
            reference: 'attachment-reference-001',
            fileSource: './windsurfrules',
            selectedContent: '# Shadcn',
          },
        ],
      },
    });
    const taskContentIdx = output.indexOf('Implement the feature');
    const attachmentsIdx = output.indexOf('<attachments>');
    expect(attachmentsIdx).toBeGreaterThan(taskContentIdx);
    expect(output).toContain('<attachment reference="attachment-reference-001">');
    expect(output).toContain('file-source="./windsurfrules"');
    expect(output).toContain('# Shadcn');
    expect(output).toContain('<user-selected-content>');
  });

  test('CLI mode omits attachments block when no snippets', () => {
    const output = generateFullCliOutput({ ...BASE_PARAMS, nativeIntegration: false });
    expect(output).not.toContain('<snippet file-source=');
  });

  test('native mode includes snippet XML when sourceAttachments has snippets', () => {
    const output = generateFullCliOutput({
      ...BASE_PARAMS,
      nativeIntegration: true,
      sourceAttachments: {
        attachedSnippets: [
          {
            reference: 'attachment-reference-001',
            fileSource: 'src/foo.ts',
            selectedContent: 'const x = 1;',
          },
        ],
      },
    });
    expect(output).toContain('<attachments>');
    expect(output).toContain('file-source="src/foo.ts"');
    expect(output).toContain('const x = 1;');
  });
});
