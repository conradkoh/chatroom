import { describe, expect, it } from 'vitest';

import { makeHarnessKey, parseHarnessKey } from './harness-key.js';
import { isNativeDirectHarnessName, NATIVE_DIRECT_HARNESS_NAMES } from './registry.js';

describe('harness registry', () => {
  it('lists all native direct harness names', () => {
    expect(NATIVE_DIRECT_HARNESS_NAMES).toEqual(['opencode-sdk', 'cursor-sdk', 'pi-sdk']);
  });

  it('isNativeDirectHarnessName validates known names', () => {
    expect(isNativeDirectHarnessName('cursor-sdk')).toBe(true);
    expect(isNativeDirectHarnessName('claude')).toBe(false);
  });
});

describe('harness-key', () => {
  it('round-trips workspace and harness name', () => {
    const key = makeHarnessKey('ws1', 'pi-sdk');
    expect(parseHarnessKey(key)).toEqual({ workspaceId: 'ws1', harnessName: 'pi-sdk' });
  });
});
