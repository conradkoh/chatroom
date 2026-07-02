import { describe, expect, test } from 'vitest';

import { composeNativeSystemPrompt } from '../../../prompts/native/system-prompt';
import { generateNativeTaskDeliveryOutput } from '../../../prompts/native/task-delivery';
import {
  getNativeTaskStartedPrompt,
  getNativeTaskStartedPromptForHandoffRecipient,
} from '../../../prompts/native/task-started-content';
import { assertNativeDeliveryTaskIntake } from '../../helpers/native-delivery-contract';
import { TEAM_CONFIGS } from '../../helpers/native-workflow-fixtures';

describe('native task-started content', () => {
  test('entry point prompt describes task intake without task read or injection', () => {
    const prompt = getNativeTaskStartedPrompt({
      chatroomId: 'room-id',
      role: 'planner',
      cliEnvPrefix: 'CHATROOM_CONVEX_URL=http://127.0.0.1:3210 ',
    });

    expect(prompt).not.toMatch(/task read/i);
    expect(prompt).not.toMatch(/inject/i);
    expect(prompt).toContain('Start working');
    expect(prompt).toContain('**Context Rule:**');
    expect(prompt).toContain('context new --chatroom-id="room-id"');
    expect(prompt).toContain('chatroom context view-template');
    expect(prompt).not.toContain('chatroom classify');
  });

  test('handoff recipient prompt is minimal', () => {
    const prompt = getNativeTaskStartedPromptForHandoffRecipient();
    expect(prompt).toContain('Begin immediately');
    expect(prompt).not.toMatch(/task read/i);
  });
});

describe('native init', () => {
  test('includes role guidance with operating model for duo planner', () => {
    const config = TEAM_CONFIGS.duo;
    const prompt = composeNativeSystemPrompt({
      chatroomId: 'room-id',
      role: 'planner',
      teamId: config.teamId,
      teamName: config.teamName,
      teamRoles: config.teamRoles,
      teamEntryPoint: config.teamEntryPoint,
      convexUrl: 'http://127.0.0.1:3210',
      agentHarness: 'cursor-sdk',
    });

    expect(prompt).toContain('## Planner Operating Model');
    expect(prompt).toContain('get-role-guidance');
    expect(prompt).not.toContain('<role-guidance>');
  });
});

describe('native task delivery', () => {
  test('includes context staleness section when context is old', () => {
    const output = generateNativeTaskDeliveryOutput({
      chatroomId: 'room-id',
      role: 'planner',
      teamId: 'duo',
      cliEnvPrefix: 'CHATROOM_CONVEX_URL=http://127.0.0.1:3210 ',
      task: { _id: 'task-id', content: 'hello' },
      message: { _id: 'msg-id', senderRole: 'user' },
      availableHandoffTargets: ['builder', 'user'],
      isEntryPoint: true,
      currentContext: { elapsedHours: 10 },
    });

    expect(output).toContain('## Context');
    expect(output).toContain('⚠️ Context is 10h old — consider refreshing if stale.');
  });

  test('omits role guidance block; operating model lives in init', () => {
    const output = generateNativeTaskDeliveryOutput({
      chatroomId: 'room-id',
      role: 'planner',
      teamId: 'duo',
      cliEnvPrefix: 'CHATROOM_CONVEX_URL=http://127.0.0.1:3210 ',
      task: { _id: 'task-id', content: 'hello' },
      message: { _id: 'msg-id', senderRole: 'user' },
      availableHandoffTargets: ['builder', 'user'],
      isEntryPoint: true,
    });

    assertNativeDeliveryTaskIntake(output, {
      entryPoint: true,
      role: 'planner',
      teamId: 'duo',
    });
    expect(output).not.toContain('## Planner Operating Model');
  });

  test('includes task content, eager templates, next steps, and handoff commands', () => {
    const output = generateNativeTaskDeliveryOutput({
      chatroomId: 'room-id',
      role: 'planner',
      teamId: 'duo',
      cliEnvPrefix: 'CHATROOM_CONVEX_URL=http://127.0.0.1:3210 ',
      task: { _id: 'task-id', content: 'hello' },
      message: { _id: 'msg-id', senderRole: 'user' },
      availableHandoffTargets: ['builder', 'user'],
    });

    expect(output).toContain('<task>');
    expect(output).toContain('hello');
    expect(output).toContain('<next-steps>');
    expect(output).toContain('you MUST run the handoff command');
    expect(output).toContain('<handoff-templates>');
    expect(output).toContain('Report Template (Planner → User)');
    expect(output).toContain('get-role-guidance --chatroom-id="room-id"');
    expect(output).toContain('<handoffs>');
    expect(output).toContain('**user**');
    expect(output).toContain('**builder**');
    expect(output).not.toContain('task injection');
    expect(output).not.toContain('Classify');
  });

  test('native delivery includes snippet XML from sourceAttachments', () => {
    const output = generateNativeTaskDeliveryOutput({
      chatroomId: 'room-id',
      role: 'builder',
      cliEnvPrefix: 'CHATROOM_CONVEX_URL=http://127.0.0.1:3210 ',
      task: {
        _id: 'task-id',
        content: 'What library is [attachment: attachment-reference-001]?',
      },
      message: { _id: 'msg-id', senderRole: 'user' },
      availableHandoffTargets: ['planner'],
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
    expect(output).toContain('<attachments>');
    expect(output).toContain('file-source="./windsurfrules"');
    expect(output).toContain('# Shadcn');
  });
});
