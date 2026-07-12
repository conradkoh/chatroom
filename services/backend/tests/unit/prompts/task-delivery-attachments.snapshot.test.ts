/**
 * Snapshot tests for task delivery attachment rendering.
 *
 * Auditable fixtures for primary delivery: backlog and snippet attachments
 * must appear in <attachments> XML alongside task content without task read.
 */

import { describe, expect, test } from 'vitest';

import { generateFullCliOutput } from '../../../prompts/cli/get-next-task/fullOutput';

const CHATROOM_ID = 'snapshot-chatroom-id';
const ROLE = 'builder';
const CLI_ENV_PREFIX = 'CHATROOM_CONVEX_URL=http://127.0.0.1:3210 ';

function extractTaskEnvelope(output: string): string {
  const start = output.indexOf('<task>');
  const end = output.indexOf('</task>');
  if (start === -1 || end === -1) {
    throw new Error('Expected <task> envelope in output');
  }
  return output.slice(start, end + '</task>'.length);
}

const BASE_PARAMS = {
  chatroomId: CHATROOM_ID,
  role: ROLE,
  cliEnvPrefix: CLI_ENV_PREFIX,
  task: {
    _id: 'task-snapshot-001',
    content: 'Can you work on this item',
  },
  message: {
    _id: 'msg-snapshot-001',
    senderRole: 'user',
    content: 'Can you work on this item',
  },
  currentContext: null,
  originMessage: null,
  followUpCountSinceOrigin: 0,
  originMessageCreatedAt: null,
  isEntryPoint: false,
  availableHandoffTargets: ['planner'],
};

describe('task delivery attachment snapshots — CLI', () => {
  test('backlog attachment in primary delivery task envelope', () => {
    const output = generateFullCliOutput({
      ...BASE_PARAMS,
      nativeIntegration: false,
      sourceAttachments: {
        attachedBacklogItems: [
          {
            _id: 'backlog-item-snapshot-001',
            status: 'backlog',
            content: 'Refactor: extract shared auth helpers into a utility module',
          },
        ],
      },
    });

    expect(extractTaskEnvelope(output)).toMatchInlineSnapshot(`
      "<task>
      ============================================================
      📋 CHATROOM TASK
      ============================================================
      Task ID: task-snapshot-001
      Origin Message ID: msg-snapshot-001
      From: user

      ## Chatroom task

      <attachments>
        <attachment type="backlog" backlog-item-id="backlog-item-snapshot-001">
          <content>Refactor: extract shared auth helpers into a utility module</content>
          <hint>Work on this item. When done: chatroom backlog mark-for-review --chatroom-id="snapshot-chatroom-id" --role="builder" --backlog-item-id=backlog-item-snapshot-001</hint>
        </attachment>
      </attachments>
      Can you work on this item

      Begin working from the task content above. The daemon detects harness output (stdout tokens) and marks the task \`in_progress\` automatically — **do not run \`task read\`** unless you need backlog items or context details not shown in the delivery.
      </task>"
    `);
  });

  test('task attachment in primary delivery task envelope', () => {
    const output = generateFullCliOutput({
      ...BASE_PARAMS,
      nativeIntegration: false,
      sourceAttachments: {
        attachedTasks: [
          {
            _id: 'attached-task-snapshot-001',
            status: 'backlog',
            content: 'Prior task: implement OAuth callback handler',
          },
        ],
      },
    });

    expect(extractTaskEnvelope(output)).toMatchInlineSnapshot(`
      "<task>
      ============================================================
      📋 CHATROOM TASK
      ============================================================
      Task ID: task-snapshot-001
      Origin Message ID: msg-snapshot-001
      From: user

      ## Chatroom task

      <attachments>
        <attachment type="task" task-id="attached-task-snapshot-001">
          <content>Prior task: implement OAuth callback handler</content>
          <hint>Referenced task attached by user.</hint>
        </attachment>
      </attachments>
      Can you work on this item

      Begin working from the task content above. The daemon detects harness output (stdout tokens) and marks the task \`in_progress\` automatically — **do not run \`task read\`** unless you need backlog items or context details not shown in the delivery.
      </task>"
    `);
  });

  test('backlog and snippet attachments in same task envelope', () => {
    const output = generateFullCliOutput({
      ...BASE_PARAMS,
      nativeIntegration: false,
      sourceAttachments: {
        attachedBacklogItems: [
          {
            _id: 'backlog-item-snapshot-002',
            status: 'backlog',
            content: 'Add login page',
          },
        ],
        attachedSnippets: [
          {
            reference: 'attachment-reference-001',
            fileSource: './src/auth.ts',
            selectedContent: 'export function login() {}',
          },
        ],
      },
    });

    expect(extractTaskEnvelope(output)).toMatchInlineSnapshot(`
      "<task>
      ============================================================
      📋 CHATROOM TASK
      ============================================================
      Task ID: task-snapshot-001
      Origin Message ID: msg-snapshot-001
      From: user

      ## Chatroom task

      <attachments>
        <attachment type="backlog" backlog-item-id="backlog-item-snapshot-002">
          <content>Add login page</content>
          <hint>Work on this item. When done: chatroom backlog mark-for-review --chatroom-id="snapshot-chatroom-id" --role="builder" --backlog-item-id=backlog-item-snapshot-002</hint>
        </attachment>
        <attachment type="snippet" reference="attachment-reference-001">
        <snippet file-source="./src/auth.ts">
          <user-selected-content>
      export function login() {}
          </user-selected-content>
        </snippet>
        </attachment>
      </attachments>
      Can you work on this item

      Begin working from the task content above. The daemon detects harness output (stdout tokens) and marks the task \`in_progress\` automatically — **do not run \`task read\`** unless you need backlog items or context details not shown in the delivery.
      </task>"
    `);
  });
});

describe('task delivery attachment snapshots — native', () => {
  test('backlog attachment in native task envelope', () => {
    const output = generateFullCliOutput({
      ...BASE_PARAMS,
      teamId: 'duo',
      nativeIntegration: true,
      sourceAttachments: {
        attachedBacklogItems: [
          {
            _id: 'backlog-item-snapshot-003',
            status: 'backlog',
            content: 'Refactor: extract shared auth helpers into a utility module',
          },
        ],
      },
    });

    expect(extractTaskEnvelope(output)).toMatchInlineSnapshot(`
      "<task>
      Task ID: task-snapshot-001
      Origin Message ID: msg-snapshot-001
      From: user


      <attachments>
        <attachment type="backlog" backlog-item-id="backlog-item-snapshot-003">
          <content>Refactor: extract shared auth helpers into a utility module</content>
          <hint>Work on this item. When done: chatroom backlog mark-for-review --chatroom-id="snapshot-chatroom-id" --role="builder" --backlog-item-id=backlog-item-snapshot-003</hint>
        </attachment>
      </attachments>
      Can you work on this item
      </task>"
    `);
  });
});
