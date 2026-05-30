import { describe, it, expect } from 'vitest';

import { formatMachineLabel } from './timelineRowStyles';

describe('formatMachineLabel', () => {
  it('returns alias when present', () => {
    const machines = new Map([['m1', { hostname: 'host.local', alias: 'Dev Mac' }]]);
    expect(formatMachineLabel(machines, 'm1')).toBe('Dev Mac');
  });

  it('falls back to hostname', () => {
    const machines = new Map([['m1', { hostname: 'host.local' }]]);
    expect(formatMachineLabel(machines, 'm1')).toBe('host.local');
  });

  it('returns null when map or id missing', () => {
    const machines = new Map([['m1', { hostname: 'host.local' }]]);
    expect(formatMachineLabel(undefined, 'm1')).toBeNull();
    expect(formatMachineLabel(machines, undefined)).toBeNull();
    expect(formatMachineLabel(machines, 'unknown')).toBeNull();
  });
});
