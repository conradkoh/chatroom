/**
 * Squad Team — Builder Handoff Output
 *
 * Verifies the output shown after a successful handoff command for the
 * builder role in a Squad team. Tests `generateHandoffOutput` which
 * produces the confirmation and get-next-task reminder after `chatroom handoff`.
 *
 * In squad team, builder hands off to reviewer or planner, never to user.
 *
 * Uses inline snapshots for human-reviewable regression detection.
 */

import { describe, expect, test } from 'vitest';

import { generateHandoffOutput } from '../../../../../prompts/generator';

const BASE_PARAMS = {
  role: 'builder',
  chatroomId: 'test-chatroom-id',
  convexUrl: 'http://127.0.0.1:3210',
};

describe('Squad Team > Builder > Handoff Output', () => {
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

      Run now to receive your next task:
      \`CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom get-next-task --chatroom-id="test-chatroom-id" --role="builder"\`"
    `);
  });

  test('handoff to planner', () => {
    const output = generateHandoffOutput({
      ...BASE_PARAMS,
      nextRole: 'planner',
    });

    expect(output).toBeDefined();
    expect(output).toContain('handed off to planner');
    expect(output).toContain('get-next-task');

    expect(output).toMatchInlineSnapshot(`
      "✅ Task completed and handed off to planner

      Run now to receive your next task:
      \`CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom get-next-task --chatroom-id="test-chatroom-id" --role="builder"\`"
    `);
  });
});
