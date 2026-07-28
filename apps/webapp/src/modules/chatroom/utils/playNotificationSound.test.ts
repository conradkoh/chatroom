import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { playNotificationSound } from './playNotificationSound';

const STORAGE_KEY = 'chatroom:notification-sound-muted';

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
    const osc = ctxMock.createOscillator.mock.results[0]?.value;
    expect(osc.start).toHaveBeenCalled();
    expect(osc.stop).toHaveBeenCalled();
    const gain = ctxMock.createGain.mock.results[0]?.value;
    expect(gain.connect).toHaveBeenCalledWith('mock-destination');
  });

  it('does not create AudioContext when muted', () => {
    localStorage.setItem(STORAGE_KEY, 'true');

    playNotificationSound();

    expect(ctxMock.createOscillator).not.toHaveBeenCalled();
  });

  it('closes AudioContext after oscillator ends', () => {
    playNotificationSound();

    const osc = ctxMock.createOscillator.mock.results[0]?.value;
    expect(osc.onended).toBeDefined();
    osc.onended();
    expect(ctxMock.close).toHaveBeenCalled();
  });

  it('plays sound when muted if force is true', () => {
    localStorage.setItem(STORAGE_KEY, 'true');

    playNotificationSound({ force: true });

    expect(ctxMock.createOscillator).toHaveBeenCalled();
  });
});
