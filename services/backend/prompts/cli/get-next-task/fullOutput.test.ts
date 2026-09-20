import { describe, expect, test } from 'vitest';

import { generateFullCliOutput } from './fullOutput';

const BASE_PARAMS = {
  chatroomId: 'test-chatroom-id',
  role: 'builder',
  cliEnvPrefix: 'CHATROOM_CONVEX_URL=http://127.0.0.1:3210 ',
  task: { _id: 'test-task-id', content: 'Implement the feature' },
  message: { _id: 'test-message-id', senderRole: 'planner', content: 'Please implement' },
  isEntryPoint: false,
  availableHandoffTargets: ['planner'],
};

function expectNoEnhancerCeremony(output: string): void {
  expect(output).not.toContain('<handoff-enhancer>');
  expect(output).not.toContain('<enhancer-input>');
  expect(output).not.toContain('<handoff-enhancer-disabled>');
  expect(output).not.toContain('Immediately hand off the user request');
}

describe('generateFullCliOutput — delivery paths', () => {
  test('native mode returns task content, eager templates, next steps, and handoff commands', () => {
    const output = generateFullCliOutput({
      ...BASE_PARAMS,
      teamId: 'duo',
      nativeIntegration: true,
    });

    expect(output).not.toContain('get-next-task');
    expect(output).toContain('<task task-id=');
    expect(output).toContain('Implement the feature');
    expect(output).toContain('<next-steps>');
    expect(output).toContain('you MUST run the handoff command');
    expect(output).toContain('<handoffs>');
    expect(output).toContain('**planner**');
    expect(output).not.toContain('task injection');
    expect(output).not.toMatch(/task read --chatroom-id/i);
    expect(output).toContain('<handoff-templates>');
    expect(output).toContain('Handoff Template (Builder → Planner)');
  });

  test('CLI mode includes handoff templates, capabilities, and footer', () => {
    const output = generateFullCliOutput({ ...BASE_PARAMS, teamId: 'duo' });

    expect(output).toContain('<handoff-templates>');
    expect(output).toContain('<handoffs>');
    expect(output).toContain('you MUST run the handoff command');
    expect(output).toContain('get-next-task');
    expectNoEnhancerCeremony(output);
  });

  test('entry-point user delivery includes planner templates and recommends user', () => {
    const output = generateFullCliOutput({
      ...BASE_PARAMS,
      role: 'planner',
      teamId: 'duo',
      isEntryPoint: true,
      message: { _id: 'msg-id', senderRole: 'user', content: 'hello' },
      availableHandoffTargets: ['builder', 'user'],
    });

    expect(output).toContain('Report Template (Planner → User)');
    expect(output).toContain('Delegation Brief (Planner → Builder)');
    expect(output).toContain('--next-role="user"');
    expectNoEnhancerCeremony(output);
  });

  test('configured specialist roles remain ordinary advertised capability data', () => {
    const output = generateFullCliOutput({
      ...BASE_PARAMS,
      teamId: 'duo',
      availableHandoffTargets: ['architect', 'uiux-engineer', 'planner'],
    });

    expect(output).toContain('<handoffs>');
    expect(output).toContain('**architect**');
    expect(output).toContain('--next-role="architect"');
    expect(output).toContain('**uiux-engineer**');
    expectNoEnhancerCeremony(output);
  });
});

describe('generateFullCliOutput — primary delivery attachments', () => {
  test('CLI mode includes backlog XML before task content', () => {
    const output = generateFullCliOutput({
      ...BASE_PARAMS,
      sourceAttachments: {
        attachedBacklogItems: [
          { _id: 'backlog-item-001', status: 'backlog', content: 'Implement dark mode toggle' },
        ],
      },
    });

    expect(output.indexOf('<attachments>')).toBeLessThan(output.indexOf('Implement the feature'));
    expect(output).toContain('type="backlog"');
    expect(output).toContain('backlog-item-id="backlog-item-001"');
  });

  test('CLI mode includes snippet XML before task content', () => {
    const output = generateFullCliOutput({
      ...BASE_PARAMS,
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

    expect(output.indexOf('<attachments>')).toBeLessThan(output.indexOf('Implement the feature'));
    expect(output).toContain('<attachment type="snippet" reference="attachment-reference-001">');
    expect(output).toContain('file-source="./windsurfrules"');
    expect(output).toContain('# Shadcn');
  });

  test('native mode includes snippet XML', () => {
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

describe('generateFullCliOutput — standing instructions', () => {
  const attachments = {
    attachedBacklogItems: [
      { _id: 'backlog-item-001', status: 'backlog', content: 'Implement dark mode toggle' },
    ],
  };

  test('places CLI instructions above attachments with XML escaping', () => {
    const output = generateFullCliOutput({
      ...BASE_PARAMS,
      standingInstructions: 'Prefer <strict> mode & coverage',
      sourceAttachments: attachments,
    });

    expect(output).toContain('Prefer &lt;strict&gt; mode &amp; coverage');
    expect(output.indexOf('<instruction>')).toBeLessThan(output.indexOf('<attachments>'));
  });

  test('places native instructions above attachments with XML escaping', () => {
    const output = generateFullCliOutput({
      ...BASE_PARAMS,
      nativeIntegration: true,
      standingInstructions: 'Prefer <strict> mode & coverage',
      sourceAttachments: attachments,
    });

    expect(output).toContain('Prefer &lt;strict&gt; mode &amp; coverage');
    expect(output.indexOf('<instruction>')).toBeLessThan(output.indexOf('<attachments>'));
  });
});

describe('generateFullCliOutput — conversation mode', () => {
  const plannerUserParams = {
    ...BASE_PARAMS,
    teamId: 'duo',
    role: 'planner',
    isEntryPoint: true,
    availableHandoffTargets: ['architect', 'uiux-engineer', 'builder', 'user'],
    message: { _id: 'msg-id', senderRole: 'user', content: 'hello' },
  };

  test('Chat mode remains direct while preserving advertised capabilities', () => {
    for (const nativeIntegration of [false, true]) {
      const output = generateFullCliOutput({
        ...plannerUserParams,
        conversationMode: 'chat',
        nativeIntegration,
      });

      expect(output).toContain('<chat-mode>');
      expect(output).toContain('Answer the user directly and concisely');
      expect(output).toContain('--next-role="user"');
      expect(output).toContain('**architect**');
      expect(output).toContain('**uiux-engineer**');
      expectNoEnhancerCeremony(output);
      if (nativeIntegration) expect(output).not.toContain('get-next-task');
      else expect(output).toContain('get-next-task');
    }
  });

  test('code:enhanced behaves as ordinary code delivery', () => {
    const output = generateFullCliOutput({
      ...plannerUserParams,
      conversationMode: 'code:enhanced',
      nativeIntegration: false,
    });

    expect(output).not.toContain('<chat-mode>');
    expect(output).toContain('--next-role="user"');
    expect(output).toContain('**architect**');
    expectNoEnhancerCeremony(output);
  });
});
