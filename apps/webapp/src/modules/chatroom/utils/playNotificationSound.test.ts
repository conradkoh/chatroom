import { beforeEach, describe, expect, it, vi } from 'vitest';

import { playNotificationSound } from './playNotificationSound';

const STORAGE_KEY = 'chatroom:notification-sound-muted';

describe('playNotificationSound', () => {
  let mockOscillator: {
    start: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
    connect: ReturnType<typeof vi.fn>;
    frequency: { value: number };
    onended: (() => void) | null;
  };
  let mockGain: {
    connect: ReturnType<typeof vi.fn>;
    gain: {
      setValueAtTime: ReturnType<typeof vi.fn>;
      exponentialRampToValueAtTime: ReturnType<typeof vi.fn>;
    };
  };
  let mockClose: ReturnType<typeof vi.fn>;
  let AudioContextMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    localStorage.clear();

    mockOscillator = {
      start: vi.fn(),
      stop: vi.fn(),
      connect: vi.fn(),
      frequency: { value: 0 },
      onended: null,
    };

    mockGain = {
      connect: vi.fn(),
      gain: {
        setValueAtTime: vi.fn(),
        exponentialRampToValueAtTime: vi.fn(),
      },
    };

    mockClose = vi.fn();

    AudioContextMock = vi.fn(() => ({
      createOscillator: () => mockOscillator,
      createGain: () => mockGain,
      destination: 'mock-destination',
      currentTime: 1000,
      close: mockClose,
    }));

    vi.stubGlobal('AudioContext', AudioContextMock);
  });

  it('creates oscillator and plays sound when unmuted', () => {
    playNotificationSound();

    expect(AudioContextMock).toHaveBeenCalled();
    expect(mockOscillator.type).toBe('sine');
    expect(mockOscillator.frequency.value).toBe(880);
    expect(mockOscillator.start).toHaveBeenCalled();
    expect(mockOscillator.stop).toHaveBeenCalled();
    expect(mockGain.connect).toHaveBeenCalledWith('mock-destination');
  });

  it('does not create AudioContext when muted', () => {
    localStorage.setItem(STORAGE_KEY, 'true');

    playNotificationSound();

    expect(AudioContextMock).not.toHaveBeenCalled();
  });

  it('closes AudioContext after oscillator ends', () => {
    playNotificationSound();

    expect(mockOscillator.onended).toBeDefined();
    mockOscillator.onended!();
    expect(mockClose).toHaveBeenCalled();
  });
});
