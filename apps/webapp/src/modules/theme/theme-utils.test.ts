import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { oppositeThemeAppearance, resolveThemeAppearance } from './theme-utils';

describe('resolveThemeAppearance', () => {
  const originalMatchMedia = window.matchMedia;

  beforeEach(() => {
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: query === '(prefers-color-scheme: dark)',
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
  });

  afterEach(() => {
    window.matchMedia = originalMatchMedia;
  });

  test('returns dark for dark theme', () => {
    expect(resolveThemeAppearance('dark')).toBe('dark');
  });

  test('returns light for light theme', () => {
    expect(resolveThemeAppearance('light')).toBe('light');
  });

  test('returns dark for system when prefers dark', () => {
    expect(resolveThemeAppearance('system')).toBe('dark');
  });

  test('returns light for system when prefers light', () => {
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
    expect(resolveThemeAppearance('system')).toBe('light');
  });

  test('returns light for null/undefined when system prefers light', () => {
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
    expect(resolveThemeAppearance(null)).toBe('light');
    expect(resolveThemeAppearance(undefined)).toBe('light');
  });
});

describe('oppositeThemeAppearance', () => {
  test('dark → light', () => {
    expect(oppositeThemeAppearance('dark')).toBe('light');
  });

  test('light → dark', () => {
    expect(oppositeThemeAppearance('light')).toBe('dark');
  });
});
