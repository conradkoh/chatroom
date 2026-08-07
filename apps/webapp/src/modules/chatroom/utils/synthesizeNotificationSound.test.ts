import { describe, expect, it } from 'vitest';

import { getNotificationSoundSchedules } from './synthesizeNotificationSound';

describe('getNotificationSoundSchedules', () => {
  it('subtle returns one schedule with 440Hz', () => {
    const s = getNotificationSoundSchedules('subtle', 1);
    expect(s).toHaveLength(1);
    expect(s[0].frequency).toBe(440);
    expect(s[0].peakGain).toBeCloseTo(0.35);
  });

  it('standard returns one schedule with 880Hz', () => {
    const s = getNotificationSoundSchedules('standard', 1);
    expect(s).toHaveLength(1);
    expect(s[0].frequency).toBe(880);
    expect(s[0].peakGain).toBeCloseTo(0.33);
  });

  it('urgent returns two ascending schedules', () => {
    const s = getNotificationSoundSchedules('urgent', 1);
    expect(s).toHaveLength(2);
    expect(s[0].frequency).toBe(587);
    expect(s[0].startTime).toBe(0);
    expect(s[1].frequency).toBe(784);
    expect(s[1].startTime).toBe(0.14);
  });

  it('urgent second tone peakGain is lower than first (no clipping)', () => {
    const s = getNotificationSoundSchedules('urgent', 1);
    expect(s[1].peakGain).toBeLessThan(s[0].peakGain);
  });

  it('volume scales peakGain linearly', () => {
    const s = getNotificationSoundSchedules('standard', 0.5);
    expect(s[0].peakGain).toBeCloseTo(0.5 * 0.33);
  });

  it('volume=0 returns zero gain', () => {
    const s = getNotificationSoundSchedules('standard', 0);
    expect(s[0].peakGain).toBe(0);
  });

  it('bright returns three ascending triangle schedules', () => {
    const s = getNotificationSoundSchedules('bright', 1);
    expect(s).toHaveLength(3);
    expect(s[0]).toMatchObject({ frequency: 784, type: 'triangle' });
    expect(s[1]).toMatchObject({ frequency: 988, type: 'triangle' });
    expect(s[2]).toMatchObject({ frequency: 1175, type: 'triangle' });
    expect(s[0].peakGain).toBeCloseTo(0.5);
  });

  it('alarm returns four square-wave pulse schedules', () => {
    const s = getNotificationSoundSchedules('alarm', 1);
    expect(s).toHaveLength(4);
    expect(s.every((x) => x.type === 'square')).toBe(true);
    expect(s[0].frequency).toBe(880);
    expect(s[2].frequency).toBe(1100);
    expect(s[3].peakGain).toBeCloseTo(0.6);
  });
});
