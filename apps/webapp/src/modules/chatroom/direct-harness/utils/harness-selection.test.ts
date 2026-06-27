import { describe, expect, it } from 'vitest';

import { filterNativeHarnesses, selectDefaultHarnessName } from './harness-selection';
import type { HarnessOption } from '../hooks/useHarnessConfig';

function harness(name: string): HarnessOption {
  return { name, displayName: name, agents: [], providers: [] };
}

describe('filterNativeHarnesses', () => {
  it('keeps only native-integration SDK harnesses', () => {
    const input = [
      harness('opencode'),
      harness('opencode-sdk'),
      harness('cursor'),
      harness('cursor-sdk'),
      harness('pi-sdk'),
    ];

    expect(filterNativeHarnesses(input).map((h) => h.name)).toEqual([
      'opencode-sdk',
      'cursor-sdk',
      'pi-sdk',
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
