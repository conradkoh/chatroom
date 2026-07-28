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
    expect(s[1].frequency).toBe(880);
    expect(s[1].startTime).toBe(0.14);
  });

  it('volume scales peakGain linearly', () => {
    const s = getNotificationSoundSchedules('standard', 0.5);
    expect(s[0].peakGain).toBeCloseTo(0.5 * 0.33);
  });

  it('volume=0 returns zero gain', () => {
    const s = getNotificationSoundSchedules('standard', 0);
    expect(s[0].peakGain).toBe(0);
  });
});
