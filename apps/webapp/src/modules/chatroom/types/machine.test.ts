import { describe, expect, it } from 'vitest';

import {
  HARNESS_DISPLAY_NAMES,
  getHarnessDisplayName,
  getModelDisplayLabel,
  harnessSupportsSessionResume,
  harnessSupportsNativeIntegration,
  isCursorSdkHarness,
  isOpenCodeSdkHarness,
} from './machine';

/**
 * Canonical list of all harnesses supported by the backend and CLI.
 * When a new harness is added, it must also be added here and to the
 * frontend HARNESS_DISPLAY_NAMES record.
 */
const ALL_KNOWN_HARNESSES: string[] = [
  'opencode',
  'opencode-sdk',
  'pi',
  'cursor',
  'cursor-sdk',
  'commandcode',
];

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
    expect(getHarnessDisplayName('cursor')).toBe('Cursor (CLI)');
    expect(getHarnessDisplayName('cursor-sdk')).toBe('Cursor (SDK)');
    expect(getHarnessDisplayName('commandcode')).toBe('CommandCode');
  });

  it('returns title-cased fallback for unknown harnesses', () => {
    expect(getHarnessDisplayName('newharness')).toBe('Newharness');
  });
});

describe('isOpenCodeSdkHarness', () => {
  it('returns true only for opencode-sdk', () => {
    expect(isOpenCodeSdkHarness('opencode-sdk')).toBe(true);
    expect(isOpenCodeSdkHarness('opencode')).toBe(false);
    expect(isOpenCodeSdkHarness('cursor-sdk')).toBe(false);
  });
});

describe('isCursorSdkHarness', () => {
  it('returns true only for cursor-sdk', () => {
    expect(isCursorSdkHarness('cursor-sdk')).toBe(true);
    expect(isCursorSdkHarness('cursor')).toBe(false);
    expect(isCursorSdkHarness('opencode-sdk')).toBe(false);
  });
});

describe('harnessSupportsSessionResume', () => {
  it.each(['opencode-sdk', 'cursor-sdk', 'pi'] as const)(
    'returns true for resumable harness "%s"',
    (harness) => {
      expect(harnessSupportsSessionResume(harness)).toBe(true);
    }
  );

  it.each(['opencode', 'cursor', 'commandcode'] as const)(
    'returns false for non-resumable harness "%s"',
    (harness) => {
      expect(harnessSupportsSessionResume(harness)).toBe(false);
    }
  );
});

describe('harnessSupportsNativeIntegration', () => {
  it.each(['opencode-sdk', 'cursor-sdk'] as const)(
    'returns true for native integration harness "%s"',
    (harness) => {
      expect(harnessSupportsNativeIntegration(harness)).toBe(true);
    }
  );

  it.each(['opencode', 'cursor', 'pi', 'commandcode'] as const)(
    'returns false for non-native harness "%s"',
    (harness) => {
      expect(harnessSupportsNativeIntegration(harness)).toBe(false);
    }
  );
});

describe('getModelDisplayLabel', () => {
  it('shows Auto for cursor-sdk auto routing model', () => {
    expect(getModelDisplayLabel('auto')).toBe('Auto');
  });

  it('shows Auto for legacy default id until daemon refresh', () => {
    expect(getModelDisplayLabel('default')).toBe('Auto');
  });
});
