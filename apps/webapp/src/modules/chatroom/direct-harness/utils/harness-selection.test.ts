import { describe, expect, it } from 'vitest';

import { resolveNativeHarnessOptions, selectDefaultHarnessName } from './harness-selection';
import type { HarnessOption } from '../hooks/useHarnessConfig';

function harness(name: string): HarnessOption {
  return { name, displayName: name, agents: [], providers: [] };
}

describe('resolveNativeHarnessOptions', () => {
  it('keeps only native-integration SDK harnesses from daemon reports', () => {
    const input = [
      harness('opencode'),
      harness('opencode-sdk'),
      harness('cursor'),
      harness('cursor-sdk'),
      harness('pi-sdk'),
    ];

    expect(resolveNativeHarnessOptions(input).map((h) => h.name)).toEqual([
      'pi-sdk',
      'cursor-sdk',
      'opencode-sdk',
    ]);
  });

  it('returns the full catalog when daemon reports no harnesses', () => {
    expect(resolveNativeHarnessOptions([]).map((h) => h.name)).toEqual([
      'pi-sdk',
      'cursor-sdk',
      'opencode-sdk',
    ]);
    expect(resolveNativeHarnessOptions([])[0]?.displayName).toBe('Pi (SDK)');
  });

  it('merges daemon-reported agents and providers into catalog entries', () => {
    const reported = [
      {
        ...harness('opencode-sdk'),
        agents: [{ name: 'build', mode: 'primary' as const }],
        providers: [{ providerID: 'openai', name: 'OpenAI', models: [] }],
      },
    ];

    const resolved = resolveNativeHarnessOptions(reported);
    expect(resolved.map((h) => h.name)).toEqual(['pi-sdk', 'cursor-sdk', 'opencode-sdk']);
    expect(resolved.find((h) => h.name === 'opencode-sdk')?.agents).toHaveLength(1);
    expect(resolved.find((h) => h.name === 'pi-sdk')?.agents).toEqual([]);
  });

  it('ignores non-native harnesses from daemon reports', () => {
    const reported = [harness('opencode'), harness('cursor-sdk')];
    expect(resolveNativeHarnessOptions(reported).map((h) => h.name)).toEqual([
      'pi-sdk',
      'cursor-sdk',
      'opencode-sdk',
    ]);
  });
});

describe('selectDefaultHarnessName', () => {
  it('prefers pi-sdk when available', () => {
    const harnesses = [harness('opencode-sdk'), harness('cursor-sdk'), harness('pi-sdk')];
    expect(selectDefaultHarnessName(harnesses)).toBe('pi-sdk');
  });

  it('falls back to cursor-sdk when pi-sdk is unavailable', () => {
    const harnesses = [harness('opencode-sdk'), harness('cursor-sdk')];
    expect(selectDefaultHarnessName(harnesses)).toBe('cursor-sdk');
  });

  it('falls back to opencode-sdk when only opencode-sdk is available', () => {
    const harnesses = [harness('opencode-sdk')];
    expect(selectDefaultHarnessName(harnesses)).toBe('opencode-sdk');
  });

  it('returns pi-sdk when no harnesses are available', () => {
    expect(selectDefaultHarnessName([])).toBe('pi-sdk');
  });
});
