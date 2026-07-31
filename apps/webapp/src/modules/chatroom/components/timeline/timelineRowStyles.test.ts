import { describe, it, expect } from 'vitest';

import {
  formatMachineLabel,
  getTimelineVirtualRowZIndex,
  TIMELINE_MESSAGE_BODY,
  TIMELINE_ROW_ROOT,
  TIMELINE_SCROLL_CONTAINER,
} from './timelineRowStyles';

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

describe('getTimelineVirtualRowZIndex', () => {
  it('returns 1-based index for virtual row stacking', () => {
    expect(getTimelineVirtualRowZIndex(0)).toBe(1);
    expect(getTimelineVirtualRowZIndex(5)).toBe(6);
  });
});

describe('timeline row stacking classes', () => {
  it('exports row isolation and body z-0 classes', () => {
    expect(TIMELINE_ROW_ROOT).toContain('isolate');
    expect(TIMELINE_MESSAGE_BODY).toContain('z-0');
  });
});

describe('TIMELINE_SCROLL_CONTAINER', () => {
  it('reserves scrollbar gutter for sticky headers', () => {
    expect(TIMELINE_SCROLL_CONTAINER).toContain('[scrollbar-gutter:stable]');
    expect(TIMELINE_SCROLL_CONTAINER).toContain('overflow-y-auto');
  });
});
