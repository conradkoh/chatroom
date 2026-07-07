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
