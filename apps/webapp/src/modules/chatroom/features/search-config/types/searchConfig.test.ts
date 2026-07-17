import { describe, expect, test } from 'vitest';
import { buildSearchConfigKey, searchConfigEntriesEqual } from './searchConfig';

describe('searchConfig types', () => {
  test('buildSearchConfigKey joins harnessName and modelKey', () => {
    expect(buildSearchConfigKey({ harnessName: 'opencode-sdk', modelKey: 'openai::gpt-4o' })).toBe(
      'opencode-sdk|openai::gpt-4o'
    );
  });

  test('searchConfigEntriesEqual matches same harness and modelKey', () => {
    const a = { harnessName: 'opencode-sdk', modelKey: 'openai::gpt-4o' };
    const b = { harnessName: 'opencode-sdk', modelKey: 'openai::gpt-4o' };
    expect(searchConfigEntriesEqual(a, b)).toBe(true);
  });

  test('searchConfigEntriesEqual rejects different modelKey', () => {
    const a = { harnessName: 'opencode-sdk', modelKey: 'openai::gpt-4o' };
    const b = { harnessName: 'opencode-sdk', modelKey: 'anthropic::claude-3' };
    expect(searchConfigEntriesEqual(a, b)).toBe(false);
  });
});
