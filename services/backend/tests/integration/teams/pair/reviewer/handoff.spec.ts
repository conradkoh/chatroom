/**
 * Pair Team — Reviewer Handoff Output
 *
 * Verifies the output shown after a successful handoff command for the
 * reviewer role in a Pair team. Tests `generateHandoffOutput` which
 * produces the confirmation and get-next-task reminder after `chatroom handoff`.
 *
 * In pair team, reviewer can hand off to user or builder.
 *
 * Uses inline snapshots for human-reviewable regression detection.
 */

import { describe, expect, test } from 'vitest';

import { generateHandoffOutput } from '../../../../../prompts/generator';

const BASE_PARAMS = {
  role: 'reviewer',
  chatroomId: 'test-chatroom-id',
  convexUrl: 'http://127.0.0.1:3210',
};

describe('Pair Team > Reviewer > Handoff Output', () => {
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

      ⏳ Next → \`CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom get-next-task --chatroom-id="test-chatroom-id" --role="reviewer"\`"
    `);
  });

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

      ⏳ Next → \`CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom get-next-task --chatroom-id="test-chatroom-id" --role="reviewer"\`"
    `);
  });
});
