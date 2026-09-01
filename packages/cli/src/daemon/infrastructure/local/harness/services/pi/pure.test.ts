import { describe, expect, it } from 'vitest';

import { parsePiSpawnModel } from './pure.js';

describe('parsePiSpawnModel', () => {
  it('extracts thinking from bracket model string', () => {
    expect(parsePiSpawnModel('anthropic/claude-sonnet[thinking=xhigh]')).toEqual({
      model: 'anthropic/claude-sonnet',
      thinking: 'xhigh',
    });
  });

  it('reconstructs provider/model when bracket is on model id only', () => {
    expect(parsePiSpawnModel('openai/gpt-5.6-luna[thinking=high]')).toEqual({
      model: 'openai/gpt-5.6-luna',
      thinking: 'high',
    });
  });

  it('returns plain model when no brackets', () => {
    expect(parsePiSpawnModel('anthropic/claude-sonnet')).toEqual({
      model: 'anthropic/claude-sonnet',
    });
  });
});
