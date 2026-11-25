/**
 * Unit tests for resolveSkillPromptRefs.
 *
 * The resolver decides which ids a skill prompt may inline into its shell
 * commands: real values when they are present and safe, placeholders otherwise.
 */

import { describe, expect, test } from 'vitest';

import { resolveSkillPromptRefs } from './prompt-context';

const UNSAFE_TOKENS = [
  'a b',
  'x"y',
  '$(rm)',
  'line\nbreak',
  'a;b',
  'jn7abc\n',
  '`rm`',
  'jn7é',
  'jn7；',
  '-',
  '--',
  'a'.repeat(129),
];

describe('resolveSkillPromptRefs', () => {
  test('keeps real ids and the cli env prefix', () => {
    expect(
      resolveSkillPromptRefs({ cliEnvPrefix: 'X ', chatroomId: 'jn7abc', role: 'builder' })
    ).toEqual({ cliEnvPrefix: 'X ', chatroomId: 'jn7abc', role: 'builder' });
  });

  test('falls back to placeholders when ids are missing', () => {
    expect(resolveSkillPromptRefs({ cliEnvPrefix: '' })).toEqual({
      cliEnvPrefix: '',
      chatroomId: '<id>',
      role: '<role>',
    });
  });

  test('falls back to placeholders when ids are empty strings', () => {
    expect(resolveSkillPromptRefs({ cliEnvPrefix: '', chatroomId: '', role: '' })).toEqual({
      cliEnvPrefix: '',
      chatroomId: '<id>',
      role: '<role>',
    });
  });

  test.each(UNSAFE_TOKENS)('falls back for unsafe chatroom id %j', (unsafe) => {
    expect(
      resolveSkillPromptRefs({ cliEnvPrefix: '', chatroomId: unsafe, role: 'builder' })
    ).toEqual({ cliEnvPrefix: '', chatroomId: '<id>', role: 'builder' });
  });

  test.each(UNSAFE_TOKENS)('falls back for unsafe role %j', (unsafe) => {
    expect(
      resolveSkillPromptRefs({ cliEnvPrefix: '', chatroomId: 'jn7abc', role: unsafe })
    ).toEqual({ cliEnvPrefix: '', chatroomId: 'jn7abc', role: '<role>' });
  });

  test('accepts a token of exactly 128 characters', () => {
    const max = 'a'.repeat(128);
    expect(resolveSkillPromptRefs({ cliEnvPrefix: '', chatroomId: max, role: max })).toEqual({
      cliEnvPrefix: '',
      chatroomId: max,
      role: max,
    });
  });

  test('accepts plain tokens with dashes and underscores', () => {
    expect(
      resolveSkillPromptRefs({ cliEnvPrefix: '', chatroomId: 'jn7abc', role: 'my-role_2' })
    ).toEqual({ cliEnvPrefix: '', chatroomId: 'jn7abc', role: 'my-role_2' });
  });
});
