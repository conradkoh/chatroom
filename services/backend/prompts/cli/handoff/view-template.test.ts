/**
 * Tests for the pair- and mode-keyed view-template renderer.
 *
 * The mode selects the body: `chat` renders the chat response, while `code`
 * and `code:enhanced` share the proof-rich report. Mode is required; the pair
 * resolves first so pair errors keep precedence.
 */

import { describe, expect, test } from 'vitest';

import { viewHandoffTemplate } from './view-template';
import { HandoffTemplatePairError } from '../handoff-templates/pair';

function expectPairError(fn: () => unknown, code: string): HandoffTemplatePairError {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(HandoffTemplatePairError);
    expect((error as HandoffTemplatePairError).code).toBe(code);
    return error as HandoffTemplatePairError;
  }
  throw new Error(`expected HandoffTemplatePairError(${code})`);
}

describe('viewHandoffTemplate — conversation mode', () => {
  test('chat renders the chat response without the report proof sections', () => {
    const chat = viewHandoffTemplate({
      from: 'planner',
      to: 'user',
      mode: 'chat',
      teamId: 'duo',
    });

    expect(chat).not.toContain('Proof of Completion');
  });

  test('code renders the proof-rich report', () => {
    const code = viewHandoffTemplate({
      from: 'planner',
      to: 'user',
      mode: 'code',
      teamId: 'duo',
    });

    expect(code).toContain('Proof of Completion');
  });

  test('code:enhanced renders byte-identical output to code', () => {
    const code = viewHandoffTemplate({
      from: 'planner',
      to: 'user',
      mode: 'code',
      teamId: 'duo',
    });
    const enhanced = viewHandoffTemplate({
      from: 'planner',
      to: 'user',
      mode: 'code:enhanced',
      teamId: 'duo',
    });

    expect(enhanced).toBe(code);
  });

  test('a mode-agnostic pair renders the same body for chat and code', () => {
    const chat = viewHandoffTemplate({
      from: 'planner',
      to: 'builder',
      mode: 'chat',
      teamId: 'duo',
    });
    const code = viewHandoffTemplate({
      from: 'planner',
      to: 'builder',
      mode: 'code',
      teamId: 'duo',
    });

    expect(chat).toBe(code);
  });

  test('missing mode throws MISSING_MODE after the pair resolves', () => {
    expect(
      expectPairError(
        () => viewHandoffTemplate({ from: 'planner', to: 'user', teamId: 'duo' }),
        'MISSING_MODE'
      ).message
    ).toContain('requires --mode (missing: --mode).');
  });

  test('an unknown mode throws UNKNOWN_MODE', () => {
    expect(
      expectPairError(
        () => viewHandoffTemplate({ from: 'planner', to: 'user', mode: 'bogus', teamId: 'duo' }),
        'UNKNOWN_MODE'
      ).message
    ).toBe('Unknown mode "bogus". Valid modes: chat, code, code:enhanced.');
  });
});
