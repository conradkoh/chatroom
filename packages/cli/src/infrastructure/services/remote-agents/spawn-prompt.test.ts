import { describe, it, expect } from 'vitest';
import { CHATROOM_PROMPT_SEPARATOR } from './opencode-sdk/compose-system-prompt';
import {
  createSpawnPrompt,
  DEFAULT_TRIGGER_PROMPT,
  type SpawnPrompt,
} from './spawn-prompt';

// Reference an unrelated value-object constant to confirm imports compose cleanly
// across siblings without coupling. Cheap sanity check; not a behavioural assertion.
void CHATROOM_PROMPT_SEPARATOR;

describe('createSpawnPrompt', () => {
  it('returns DEFAULT_TRIGGER_PROMPT when input is undefined', () => {
    expect(createSpawnPrompt(undefined)).toBe(DEFAULT_TRIGGER_PROMPT);
  });

  it('returns DEFAULT_TRIGGER_PROMPT when input is null', () => {
    expect(createSpawnPrompt(null)).toBe(DEFAULT_TRIGGER_PROMPT);
  });

  it('returns DEFAULT_TRIGGER_PROMPT when input is the empty string', () => {
    expect(createSpawnPrompt('')).toBe(DEFAULT_TRIGGER_PROMPT);
  });

  it('returns DEFAULT_TRIGGER_PROMPT when input is whitespace only', () => {
    expect(createSpawnPrompt('   \n\t  ')).toBe(DEFAULT_TRIGGER_PROMPT);
  });

  it('returns the input unchanged when it is non-empty', () => {
    expect(createSpawnPrompt('do the thing')).toBe('do the thing');
  });

  it('trims surrounding whitespace from non-empty inputs', () => {
    expect(createSpawnPrompt('  trimmable  ')).toBe('trimmable');
  });

  it('round-trips DEFAULT_TRIGGER_PROMPT itself (callers can re-wrap)', () => {
    expect(createSpawnPrompt(DEFAULT_TRIGGER_PROMPT)).toBe(DEFAULT_TRIGGER_PROMPT);
  });

  it('produced value satisfies the non-empty invariant', () => {
    for (const raw of [undefined, null, '', '   ', 'real']) {
      const sp = createSpawnPrompt(raw);
      expect(sp.trim().length).toBeGreaterThan(0);
    }
  });

  it('return type is assignable to SpawnPrompt (compile-time contract)', () => {
    const sp: SpawnPrompt = createSpawnPrompt('x');
    // Brand is structurally a string at runtime
    expect(typeof sp).toBe('string');
  });
});
