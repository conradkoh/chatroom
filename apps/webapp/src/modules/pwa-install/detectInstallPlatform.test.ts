import { describe, expect, it } from 'vitest';

import { detectInstallPlatform, type DetectInstallPlatformInput } from './detectInstallPlatform';

function base(overrides: Partial<DetectInstallPlatformInput> = {}): DetectInstallPlatformInput {
  return {
    userAgent: '',
    platform: '',
    maxTouchPoints: 0,
    isStandalone: false,
    ...overrides,
  };
}

describe('detectInstallPlatform', () => {
  it('returns already-installed when running standalone', () => {
    expect(detectInstallPlatform(base({ isStandalone: true }))).toBe('already-installed');
  });

  it('detects iOS Safari', () => {
    expect(
      detectInstallPlatform(
        base({
          userAgent:
            'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
          platform: 'iPhone',
          maxTouchPoints: 5,
        })
      )
    ).toBe('ios-safari');
  });

  it('detects iOS iPad Safari via MacIntel + touch points', () => {
    expect(
      detectInstallPlatform(
        base({
          userAgent:
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
          platform: 'MacIntel',
          maxTouchPoints: 5,
        })
      )
    ).toBe('ios-safari');
  });

  it('detects iOS non-Safari (Chrome)', () => {
    expect(
      detectInstallPlatform(
        base({
          userAgent:
            'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/120.0.0.0 Mobile/15E148 Safari/604.1',
          platform: 'iPhone',
          maxTouchPoints: 5,
        })
      )
    ).toBe('ios-other');
  });

  it('detects Android Chrome', () => {
    expect(
      detectInstallPlatform(
        base({
          userAgent:
            'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
          platform: 'Linux armv8l',
          maxTouchPoints: 5,
        })
      )
    ).toBe('android-chrome');
  });

  it('detects Android other (Firefox)', () => {
    expect(
      detectInstallPlatform(
        base({
          userAgent: 'Mozilla/5.0 (Android 14; Mobile; rv:121.0) Gecko/121.0 Firefox/121.0',
          platform: 'Android',
          maxTouchPoints: 5,
        })
      )
    ).toBe('android-other');
  });

  it('detects desktop Edge', () => {
    expect(
      detectInstallPlatform(
        base({
          userAgent:
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0',
          platform: 'Win32',
          maxTouchPoints: 0,
        })
      )
    ).toBe('desktop-edge');
  });

  it('detects desktop Chrome', () => {
    expect(
      detectInstallPlatform(
        base({
          userAgent:
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          platform: 'Win32',
          maxTouchPoints: 0,
        })
      )
    ).toBe('desktop-chrome');
  });

  it('detects desktop Safari', () => {
    expect(
      detectInstallPlatform(
        base({
          userAgent:
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
          platform: 'MacIntel',
          maxTouchPoints: 0,
        })
      )
    ).toBe('desktop-safari');
  });

  it('detects desktop other browsers', () => {
    expect(
      detectInstallPlatform(
        base({
          userAgent: 'Mozilla/5.0 (X11; Linux x86_64; rv:121.0) Gecko/20100101 Firefox/121.0',
          platform: 'Linux x86_64',
          maxTouchPoints: 0,
        })
      )
    ).toBe('desktop-other');
  });
});
