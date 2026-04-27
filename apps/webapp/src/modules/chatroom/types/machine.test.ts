import { describe, expect, it } from 'vitest';

import { HARNESS_DISPLAY_NAMES, getHarnessDisplayName } from './machine';

/**
 * Canonical list of all harnesses supported by the backend and CLI.
 * When a new harness is added, it must also be added here and to the
 * frontend HARNESS_DISPLAY_NAMES record.
 */
const ALL_KNOWN_HARNESSES: string[] = ['opencode', 'opencode-sdk', 'pi', 'cursor'];

describe('HARNESS_DISPLAY_NAMES', () => {
  it.each(ALL_KNOWN_HARNESSES)('should have a display name for the "%s" harness', (harness) => {
    const displayName = HARNESS_DISPLAY_NAMES[harness];
    expect(displayName).toBeDefined();
    expect(typeof displayName).toBe('string');
    expect(displayName.length).toBeGreaterThan(0);
  });

  it('should have display names for every known harness (completeness check)', () => {
    const displayNameKeys = Object.keys(HARNESS_DISPLAY_NAMES);
    for (const harness of ALL_KNOWN_HARNESSES) {
      expect(displayNameKeys).toContain(harness);
    }
  });
});

describe('getHarnessDisplayName', () => {
  it('returns known display name for registered harnesses', () => {
    expect(getHarnessDisplayName('opencode')).toBe('OpenCode (CLI)');
    expect(getHarnessDisplayName('opencode-sdk')).toBe('OpenCode (SDK)');
    expect(getHarnessDisplayName('pi')).toBe('Pi');
    expect(getHarnessDisplayName('cursor')).toBe('Cursor');
  });

  it('returns title-cased fallback for unknown harnesses', () => {
    expect(getHarnessDisplayName('newharness')).toBe('Newharness');
  });
});
