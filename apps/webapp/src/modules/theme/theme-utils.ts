/**
 * Theme utility functions
 */

export type Theme = 'light' | 'dark' | 'system';

const THEMES: Theme[] = ['light', 'dark', 'system'];

export function normalizeTheme(value: string | null | undefined): Theme {
  if (value != null && (THEMES as string[]).includes(value)) {
    return value as Theme;
  }
  return 'system';
}

export function readStoredTheme(): Theme {
  if (typeof window === 'undefined') {
    return 'system';
  }

  return normalizeTheme(window.__theme?.value ?? localStorage.getItem('theme'));
}

export type ThemeAppearance = 'light' | 'dark';

export function resolveThemeAppearance(theme: Theme | null | undefined): ThemeAppearance {
  if (theme === 'dark') return 'dark';
  if (theme === 'light') return 'light';
  if (typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches) {
    return 'dark';
  }
  return 'light';
}

export function oppositeThemeAppearance(appearance: ThemeAppearance): ThemeAppearance {
  return appearance === 'dark' ? 'light' : 'dark';
}
