import { describe, expect, it } from 'vitest';

import {
  isNativeDirectHarnessName,
  NATIVE_DIRECT_HARNESS_NAMES,
} from './bound-harness-registry.js';
import {
  makeHarnessKey,
  parseHarnessKey,
} from '../../../../infrastructure/harnesses/harness-key.js';

describe('harness registry', () => {
  it('lists all native direct harness names', () => {
    expect(NATIVE_DIRECT_HARNESS_NAMES).toEqual([
      'opencode-sdk',
      'cursor-sdk',
      'pi-sdk',
      'claude-sdk',
    ]);
  });

  it('isNativeDirectHarnessName validates known names', () => {
    expect(isNativeDirectHarnessName('cursor-sdk')).toBe(true);
    expect(isNativeDirectHarnessName('claude-sdk')).toBe(true);
    expect(isNativeDirectHarnessName('claude')).toBe(false);
  });
});

describe('harness-key', () => {
  it('round-trips workspace and harness name', () => {
    const key = makeHarnessKey('ws1', 'pi-sdk');
    expect(parseHarnessKey(key)).toEqual({ workspaceId: 'ws1', harnessName: 'pi-sdk' });
  });
});
