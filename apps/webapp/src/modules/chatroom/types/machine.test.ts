import { describe, expect, it } from 'vitest';

import {
  HARNESS_DISPLAY_NAMES,
  formatHarnessLabel,
  getHarnessDisplayName,
  getModelDisplayLabel,
  getCompactModelId,
  harnessSupportsDaemonMemoryResume,
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
  'pi-sdk',
  'cursor',
  'cursor-sdk',
  'claude',
  'claude-sdk',
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

describe('formatHarnessLabel', () => {
  it('returns display name without version when version is absent', () => {
    expect(formatHarnessLabel('opencode-sdk')).toBe('OpenCode (SDK)');
  });

  it('appends version suffix when version is provided', () => {
    expect(formatHarnessLabel('opencode-sdk', { version: '1.17.18', major: 1 })).toBe(
      'OpenCode (SDK) v1.17.18'
    );
  });
});

describe('getHarnessDisplayName', () => {
  it('returns known display name for registered harnesses', () => {
    expect(getHarnessDisplayName('opencode')).toBe('OpenCode (CLI)');
    expect(getHarnessDisplayName('opencode-sdk')).toBe('OpenCode (SDK)');
    expect(getHarnessDisplayName('pi')).toBe('Pi');
    expect(getHarnessDisplayName('pi-sdk')).toBe('Pi (SDK)');
    expect(getHarnessDisplayName('cursor')).toBe('Cursor (CLI)');
    expect(getHarnessDisplayName('cursor-sdk')).toBe('Cursor (SDK)');
    expect(getHarnessDisplayName('claude')).toBe('Claude Code');
    expect(getHarnessDisplayName('claude-sdk')).toBe('Claude (SDK)');
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

describe('harnessSupportsDaemonMemoryResume', () => {
  it('returns true only for cursor-sdk and opencode-sdk', () => {
    expect(harnessSupportsDaemonMemoryResume('cursor-sdk')).toBe(true);
    expect(harnessSupportsDaemonMemoryResume('opencode-sdk')).toBe(true);
    expect(harnessSupportsDaemonMemoryResume('cursor')).toBe(false);
    expect(harnessSupportsDaemonMemoryResume('pi-sdk')).toBe(false);
  });
});

describe('harnessSupportsNativeIntegration', () => {
  it.each(['opencode-sdk', 'cursor-sdk', 'pi-sdk', 'claude-sdk'] as const)(
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

describe('getCompactModelId', () => {
  it('returns the last segment of a provider/model path', () => {
    expect(getCompactModelId('github-copilot/gpt-4o')).toBe('gpt-4o');
  });

  it('returns the model unchanged when there is no slash', () => {
    expect(getCompactModelId('auto')).toBe('auto');
  });

  it('returns the last segment for multi-segment paths', () => {
    expect(getCompactModelId('provider/subprovider/model-name')).toBe('model-name');
  });
});
