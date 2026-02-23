/**
 * Squad Team — Planner Handoff Output
 *
 * Verifies the output shown after a successful handoff command for the
 * planner role in a Squad team. Tests `generateHandoffOutput` which
 * produces the confirmation and get-next-task reminder after `chatroom handoff`.
 *
 * Uses inline snapshots for human-reviewable regression detection.
 */

import { describe, expect, test } from 'vitest';

import { generateHandoffOutput } from '../../../../../prompts/generator';

const BASE_PARAMS = {
  role: 'planner',
  chatroomId: 'test-chatroom-id',
  convexUrl: 'http://127.0.0.1:3210',
};

describe('Squad Team > Planner > Handoff Output', () => {
  test('handoff to builder', () => {
    const output = generateHandoffOutput({
      ...BASE_PARAMS,
      nextRole: 'builder',
    });

    expect(output).toBeDefined();
    expect(output).toContain('handed off to builder');
    expect(output).toContain('get-next-task');

    expect(output).toMatchInlineSnapshot(`
      "✅ Task completed and handed off to builder

      ⏳ Next → \`CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom get-next-task --chatroom-id=test-chatroom-id --role=planner\`"
    `);
  });

  test('handoff to reviewer', () => {
    const output = generateHandoffOutput({
      ...BASE_PARAMS,
      nextRole: 'reviewer',
    });

    expect(output).toBeDefined();
    expect(output).toContain('handed off to reviewer');
    expect(output).toContain('get-next-task');

    expect(output).toMatchInlineSnapshot(`
      "✅ Task completed and handed off to reviewer

      ⏳ Next → \`CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom get-next-task --chatroom-id=test-chatroom-id --role=planner\`"
    `);
  });

  test('handoff to user', () => {
    const output = generateHandoffOutput({
      ...BASE_PARAMS,
      nextRole: 'user',
    });

    expect(output).toBeDefined();
    expect(output).toContain('handed off to user');
    expect(output).toContain('get-next-task');

    expect(output).toMatchInlineSnapshot(`
      "✅ Task completed and handed off to user

      ⏳ Next → \`CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom get-next-task --chatroom-id=test-chatroom-id --role=planner\`"
    `);
  });
});
