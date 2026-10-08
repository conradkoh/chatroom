import { describe, expect, it } from 'vitest';

import {
  HARNESS_DISPLAY_NAMES,
  formatHarnessLabel,
  getHarnessDisplayName,
  getModelDisplayLabel,
  getCompactModelId,
  getCompactModelLabel,
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

  it('shows effort variant labels for claude models', () => {
    expect(getModelDisplayLabel('sonnet[effort=high]')).toBe('Sonnet [effort=high]');
    expect(getModelDisplayLabel('sonnet')).toBe('Sonnet');
    expect(getModelDisplayLabel('sonnet[effort=none]')).toBe('Sonnet [effort=none]');
  });

  it('shows reasoning variant labels for codex models', () => {
    expect(getModelDisplayLabel('gpt-5.6-terra')).toBe('Gpt 5.6 Terra');
    expect(getModelDisplayLabel('gpt-5.6-terra[reasoning=none]')).toBe(
      'Gpt 5.6 Terra [reasoning=none]'
    );
    expect(getModelDisplayLabel('gpt-5.6-terra[reasoning=high]')).toBe(
      'Gpt 5.6 Terra [reasoning=high]'
    );
  });

  it.each([
    ['anthropic/claude-opus-5-5', 'Anthropic / Claude Opus 5.5'],
    ['anthropic/claude-haiku-5-5', 'Anthropic / Claude Haiku 5.5'],
    ['anthropic/claude-sonnet-5-5', 'Anthropic / Claude Sonnet 5.5'],
    ['anthropic/claude-mythos-5-1', 'Anthropic / Claude Mythos 5.1'],
    ['anthropic/claude-fable-5-1', 'Anthropic / Claude Fable 5.1'],
    ['anthropic/claude-opus-4-8', 'Anthropic / Claude Opus 4.8'],
    ['anthropic/claude-sonnet-4-7', 'Anthropic / Claude Sonnet 4.7'],
    ['anthropic/claude-haiku-4-6', 'Anthropic / Claude Haiku 4.6'],
    ['anthropic/claude-opus-4-5', 'Anthropic / Claude Opus 4.5'],
    ['anthropic/claude-3-5-sonnet', 'Anthropic / Claude 3.5 Sonnet'],
    ['google/gemini-2-5-pro', 'Google / Gemini 2.5 Pro'],
    ['deepseek-v3-2', 'Deepseek V3.2'],
    ['llama-3-1-70b', 'Llama 3.1 70b'],
    ['anthropic/claude-opus-5', 'Anthropic / Claude Opus 5'],
    ['openai/gpt-5.6-terra', 'Openai / Gpt 5.6 Terra'],
    ['cursor/composer-2.5', 'Cursor / Composer 2.5'],
    ['github-copilot/claude-opus-5-5', 'Github Copilot / Claude Opus 5.5'],
    ['anthropic/claude-haiku-4-5-20251001', 'Anthropic / Claude Haiku 4.5 20251001'],
    ['anthropic/claude-haiku-5-5[effort=xhigh]', 'Anthropic / Claude Haiku 5.5 [effort=xhigh]'],
    ['gpt-5.6-terra[reasoning=high]', 'Gpt 5.6 Terra [reasoning=high]'],
  ] as const)('formats model version tokens in %s', (modelId, expected) => {
    expect(getModelDisplayLabel(modelId)).toBe(expected);
  });

  it('keeps provider labels and pinned date tokens separate from model versions', () => {
    expect(getModelDisplayLabel('github-copilot/claude-haiku-4-5-20251001')).toBe(
      'Github Copilot / Claude Haiku 4.5 20251001'
    );
  });

  it('preserves short date components after long numeric tokens', () => {
    expect(getModelDisplayLabel('openai/gpt-4o-2024-11-20')).toBe('Openai / Gpt 4o 2024 11 20');
    expect(getModelDisplayLabel('openai/gpt-4-2025-04-14')).toBe('Openai / Gpt 4 2025 04 14');
    expect(getModelDisplayLabel('anthropic/claude-haiku-4-5-2025-10-01')).toBe(
      'Anthropic / Claude Haiku 4.5 2025 10 01'
    );
  });

  it('omits selected variant parameters while retaining dotted model versions', () => {
    expect(
      getModelDisplayLabel('anthropic/claude-opus-5-5[effort=high,thinking=enabled]', {
        omitParamKeys: new Set(['effort']),
      })
    ).toBe('Anthropic / Claude Opus 5.5 [thinking=enabled]');
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

  it('preserves raw model ids with hyphenated version tokens', () => {
    expect(getCompactModelId('anthropic/claude-opus-5-5')).toBe('claude-opus-5-5');
    expect(getCompactModelId('anthropic/claude-haiku-4-5-2025-10-01')).toBe(
      'claude-haiku-4-5-2025-10-01'
    );
  });
});

describe('getCompactModelLabel', () => {
  it('returns compact model id for plain provider/model paths', () => {
    expect(getCompactModelLabel('github-copilot/gpt-4o')).toBe('gpt-4o');
  });

  it('appends normalized reasoning level', () => {
    expect(getCompactModelLabel('gpt-5.6-terra[reasoning=high]')).toBe('gpt-5.6-terra [high]');
  });

  it('appends normalized effort level', () => {
    expect(getCompactModelLabel('claude-opus-4-8[effort=high]')).toBe('claude-opus-4.8 [high]');
    expect(getCompactModelLabel('anthropic/claude-opus-5-5[effort=high]')).toBe(
      'claude-opus-5.5 [high]'
    );
  });

  it('keeps date components separate in compact labels', () => {
    expect(getCompactModelLabel('openai/gpt-4o-2024-11-20')).toBe('gpt-4o-2024-11-20');
    expect(getCompactModelLabel('openai/gpt-4-2025-04-14')).toBe('gpt-4-2025-04-14');
    expect(getCompactModelLabel('anthropic/claude-haiku-4-5-2025-10-01')).toBe(
      'claude-haiku-4.5-2025-10-01'
    );
  });

  it('appends a variant level', () => {
    expect(getCompactModelLabel('openai/gpt-6-luna[variant=high]')).toBe('gpt-6-luna [high]');
  });

  it('prefers effort over variant when both are present', () => {
    expect(getCompactModelLabel('openai/gpt-6-luna[effort=medium,variant=high]')).toBe(
      'gpt-6-luna [medium]'
    );
  });

  it('prefers effort over thinking when both are present', () => {
    expect(getCompactModelLabel('claude-opus-4-8[effort=high,thinking=enabled]')).toBe(
      'claude-opus-4.8 [high]'
    );
  });

  it('renders boolean thinking marker as thinking', () => {
    expect(getCompactModelLabel('claude-opus-4-8[thinking=enabled]')).toBe(
      'claude-opus-4.8 [thinking]'
    );
  });

  it('returns plain compact model id when no variant level exists', () => {
    expect(getCompactModelLabel('composer-2.5')).toBe('composer-2.5');
  });

  it('renders future non-boolean thinking values', () => {
    expect(getCompactModelLabel('gpt-5.6[thinking=high]')).toBe('gpt-5.6 [high]');
  });

  it('falls back to compact model id for malformed variants', () => {
    expect(getCompactModelLabel('gpt-5.6[reasoning]')).toBe('gpt-5.6[reasoning]');
  });
});
