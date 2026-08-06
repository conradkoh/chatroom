import { describe, expect, it, vi } from 'vitest';

import {
  refreshMachineCapabilities,
  startBackgroundMachineCapabilitiesDiscovery,
  type RefreshMachineCapabilitiesDeps,
  type RefreshMachineCapabilitiesOutcome,
  type StartBackgroundCapabilitiesDiscoveryDeps,
} from './refresh-machine-capabilities.js';

describe('refreshMachineCapabilities', () => {
  it('returns outcome from refresh port', async () => {
    const outcomes: RefreshMachineCapabilitiesOutcome[] = [
      { kind: 'noop' },
      { kind: 'skipped_no_changes' },
      { kind: 'pushed' },
      { kind: 'failed', message: 'discovery failed' },
    ];

    for (const expected of outcomes) {
      const deps: RefreshMachineCapabilitiesDeps = {
        refresh: { refresh: vi.fn().mockResolvedValue(expected) },
      };
      await expect(refreshMachineCapabilities(deps)).resolves.toEqual(expected);
    }
  });

  it('calls refresh port refresh()', async () => {
    const refresh = vi.fn().mockResolvedValue({ kind: 'pushed' });
    const deps: RefreshMachineCapabilitiesDeps = { refresh: { refresh } };

    await refreshMachineCapabilities(deps);

    expect(refresh).toHaveBeenCalledOnce();
  });
});

describe('startBackgroundMachineCapabilitiesDiscovery', () => {
  it('calls discovery port start()', () => {
    const start = vi.fn();
    const deps: StartBackgroundCapabilitiesDiscoveryDeps = { discovery: { start } };

    startBackgroundMachineCapabilitiesDiscovery(deps);

    expect(start).toHaveBeenCalledOnce();
  });
});
