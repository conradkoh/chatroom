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

  test('entry point prompt pre-fills trigger message ID when provided', () => {
    const prompt = getNativeTaskStartedPrompt({
      chatroomId: 'room-id',
      role: 'planner',
      cliEnvPrefix: 'CHATROOM_CONVEX_URL=http://127.0.0.1:3210 ',
      triggerMessageId: 'msg-id-123',
    });

    expect(prompt).toContain('--trigger-message-id="msg-id-123"');
    expect(prompt).not.toContain('<userMessageId>');
    expect(prompt).toContain('never `task-id`');
  });

  test('native task delivery shows origin message ID and pre-fills context command', () => {
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

    expect(output).toContain('task-id="task-id"');
    expect(output).toContain('origin-message-id="msg-id"');
    expect(output).toContain('--trigger-message-id="msg-id"');
    expect(output).not.toContain('<userMessageId>');
  });

  test('handoff recipient prompt is minimal', () => {
    const prompt = getNativeTaskStartedPromptForHandoffRecipient();
    expect(prompt).toContain('Begin immediately');
    expect(prompt).not.toMatch(/task read/i);
  });

  test('enhancer review intake omits context new', () => {
    const output = generateNativeTaskDeliveryOutput({
      chatroomId: 'room-id',
      role: 'planner',
      teamId: 'duo',
      cliEnvPrefix: 'CHATROOM_CONVEX_URL=http://127.0.0.1:3210 ',
      task: { _id: 'task-id', content: '## Summary\nFeedback' },
      message: { _id: 'enh-msg-id', senderRole: 'enhancer' },
      availableHandoffTargets: ['enhancer', 'builder', 'user'],
      isEntryPoint: true,
      plannerEnhancerEnabled: true,
    });

    expect(output).toContain(
      'CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom context read --chatroom-id="room-id" --role="planner"'
    );
    expect(output).not.toContain('--trigger-message-id="enh-msg-id"');
    expect(output).not.toContain('Handoff to `enhancer`');
    expect(output).toContain('<enhancer-input>');
    expect(output).toContain('Handoff to `builder`');
  });

  test('enhancer enabled user task includes delegation-loop workflow guidance', () => {
    const output = generateNativeTaskDeliveryOutput({
      chatroomId: 'room-id',
      role: 'planner',
      teamId: 'duo',
      cliEnvPrefix: 'CHATROOM_CONVEX_URL=http://127.0.0.1:3210 ',
      task: { _id: 'task-id', content: 'Implement feature' },
      message: { _id: 'user-msg-id', senderRole: 'user' },
      availableHandoffTargets: ['enhancer', 'builder', 'user'],
      isEntryPoint: true,
      plannerEnhancerEnabled: true,
    });

    expect(output).toContain('<handoff-enhancer>');
    expect(output).toContain('Immediately hand off the user request');
    expect(output).toContain('before planning, researching, or drafting');
    expect(output).toContain('--next-role="enhancer"');
    expect(output).toContain('Handoff to `enhancer`');
    expect(output).toContain('--trigger-message-id="user-msg-id"');
    expect(output).not.toContain('<enhancer-input>');
    expect(output).toContain('user → enhancer → planner → [loop builder → planner] → user');
  });

  test('enhancer disabled user task omits enhancer sections', () => {
    const output = generateNativeTaskDeliveryOutput({
      chatroomId: 'room-id',
      role: 'planner',
      teamId: 'duo',
      cliEnvPrefix: 'CHATROOM_CONVEX_URL=http://127.0.0.1:3210 ',
      task: { _id: 'task-id', content: 'Implement feature' },
      message: { _id: 'user-msg-id', senderRole: 'user' },
      availableHandoffTargets: ['builder', 'user'],
      isEntryPoint: true,
      plannerEnhancerEnabled: false,
    });

    expect(output).not.toContain('<handoff-enhancer>');
    expect(output).not.toContain('Handoff to `enhancer`');
    expect(output).toContain('--next-role="user"');
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

    expect(output).toContain('<task task-id=');
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
