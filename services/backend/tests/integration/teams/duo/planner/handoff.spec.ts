/**
 * Duo Team — Planner Handoff Output
 *
 * Verifies the output shown after a successful handoff command for the
 * planner role in a Duo team. Tests `generateHandoffOutput` which
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

describe('Duo Team > Planner > Handoff Output', () => {
  test('handoff to builder', () => {
    const output = generateHandoffOutput({
      ...BASE_PARAMS,
      nextRole: 'builder',
    });

    expect(output).toBeDefined();
    expect(output).toContain('handed off to builder');
    expect(output).toContain('get-next-task');

    expect(output).toMatchInlineSnapshot(`
      "✅ Chatroom task completed and handed off to builder

      ✅ Level B complete (chatroom task handed off).
      ⏳ Level A continues (session is still active) — run get-next-task to stay connected:

      \`CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom get-next-task --chatroom-id="test-chatroom-id" --role="planner"\`

      **Handoff complete. End your turn now — stop tool calls. The system will send you a message when further action is required.**
      The system delivers \`builder\`'s handback when they finish — do not poll \`messages download\` while waiting. For history reconstruction tasks, \`messages download\` is the correct tool."
    `);
  });

  test('handoff to enhancer uses async check-in output when job queued', () => {
    const output = generateHandoffOutput({
      ...BASE_PARAMS,
      nextRole: 'enhancer',
      enhancerRequestQueued: true,
    });

    expect(output).toContain('queued for handoff enhancer');
    expect(output).toContain('get-next-task');
    expect(output).toContain('monitor the enhancer');
    expect(output).toContain('stop tool calls');
    expect(output).toContain('system will send you a message when further action is required');
    expect(output).not.toContain('handed off to enhancer');
  });

  test('handoff to enhancer without queued job uses standard handoff output', () => {
    const output = generateHandoffOutput({
      ...BASE_PARAMS,
      nextRole: 'enhancer',
    });

    expect(output).toContain('handed off to enhancer');
    expect(output).toContain('get-next-task');
    expect(output).not.toContain('queued for handoff enhancer');
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
      "✅ Chatroom task completed and handed off to user

      ✅ Level B complete (chatroom task handed off).
      ⏳ Level A continues (session is still active) — run get-next-task to stay connected:

      \`CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom get-next-task --chatroom-id="test-chatroom-id" --role="planner"\`

      **Handoff complete. End your turn now — stop tool calls. The system will send you a message when further action is required.**
      The system delivers the next chatroom task when the user sends one."
    `);
  });
});
