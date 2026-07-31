import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { playNotificationSound } from './playNotificationSound';

const STORAGE_KEY = 'chatroom:notification-sound-settings';

describe('playNotificationSound', () => {
  let ctxMock: {
    createOscillator: ReturnType<typeof vi.fn>;
    createGain: ReturnType<typeof vi.fn>;
    destination: string;
    currentTime: number;
    close: ReturnType<typeof vi.fn>;
  };
  let originalAudioContext: typeof AudioContext | undefined;

  beforeEach(() => {
    localStorage.clear();

    ctxMock = {
      createOscillator: vi.fn(() => ({
        start: vi.fn(),
        stop: vi.fn(),
        connect: vi.fn(),
        frequency: { value: 0 },
        onended: null,
      })),
      createGain: vi.fn(() => ({
        connect: vi.fn(),
        gain: {
          setValueAtTime: vi.fn(),
          exponentialRampToValueAtTime: vi.fn(),
        },
      })),
      destination: 'mock-destination',
      currentTime: 1000,
      close: vi.fn(),
    };

    originalAudioContext = window.AudioContext;
    window.AudioContext = class {
      constructor() {
        return ctxMock;
      }
    } as unknown as typeof AudioContext;
  });

  afterEach(() => {
    window.AudioContext = originalAudioContext!;
  });

  it('creates oscillator and plays sound when unmuted', () => {
    playNotificationSound();

    expect(ctxMock.createOscillator).toHaveBeenCalled();
    expect(ctxMock.createGain).toHaveBeenCalled();
    const osc = ctxMock.createOscillator.mock.results[0]?.value;
    expect(osc.start).toHaveBeenCalled();
    expect(osc.stop).toHaveBeenCalled();
    const gain = ctxMock.createGain.mock.results[0]?.value;
    expect(gain.connect).toHaveBeenCalledWith('mock-destination');
  });

  it('does not create AudioContext when muted', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ muted: true }));

    playNotificationSound();

    expect(ctxMock.createOscillator).not.toHaveBeenCalled();
  });

  it('plays sound when muted if force is true', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ muted: true }));

    playNotificationSound({ force: true });

    expect(ctxMock.createOscillator).toHaveBeenCalled();
  });

  it('no-ops when volume is 0', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ volume: 0, muted: false }));

    playNotificationSound();

    expect(ctxMock.createOscillator).not.toHaveBeenCalled();
  });

  it('uses preview profile/volume over settings', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ profile: 'subtle', volume: 0.5 }));

    playNotificationSound({ preview: { profile: 'urgent', volume: 1 } });

    expect(ctxMock.createOscillator).toHaveBeenCalled();
  });

  it('preview volume scales peak gain (0.3 lower than 1.0)', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ profile: 'standard', volume: 1 }));

    playNotificationSound({ preview: { profile: 'standard', volume: 1 } });
    const gainHigh = ctxMock.createGain.mock.results[0]?.value;
    const highPeak = gainHigh.gain.exponentialRampToValueAtTime.mock.calls[0][0];

    ctxMock.createGain.mockClear();
    playNotificationSound({ preview: { profile: 'standard', volume: 0.3 } });
    const gainLow = ctxMock.createGain.mock.results[0]?.value;
    const lowPeak = gainLow.gain.exponentialRampToValueAtTime.mock.calls[0][0];

    expect(lowPeak).toBeLessThan(highPeak);
  });
});
