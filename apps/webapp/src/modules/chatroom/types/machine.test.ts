import { describe, expect, it } from 'vitest';
import { HARNESS_DISPLAY_NAMES, type AgentHarness } from './machine';

/**
 * Canonical list of all harnesses supported by the backend and CLI.
 * When a new harness is added, it must also be added here and to the
 * frontend AgentHarness type + HARNESS_DISPLAY_NAMES record.
 */
const ALL_KNOWN_HARNESSES: string[] = ['opencode', 'pi', 'cursor'];

describe('HARNESS_DISPLAY_NAMES', () => {
  it.each(ALL_KNOWN_HARNESSES)(
    'should have a display name for the "%s" harness',
    (harness) => {
      const displayName = HARNESS_DISPLAY_NAMES[harness as AgentHarness];
      expect(displayName).toBeDefined();
      expect(typeof displayName).toBe('string');
      expect(displayName.length).toBeGreaterThan(0);
    }
  );

  it('should have display names for every known harness (completeness check)', () => {
    const displayNameKeys = Object.keys(HARNESS_DISPLAY_NAMES);
    for (const harness of ALL_KNOWN_HARNESSES) {
      expect(displayNameKeys).toContain(harness);
    }
  });
});
