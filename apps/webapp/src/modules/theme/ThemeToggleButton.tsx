'use client';

import { Moon, Sun } from 'lucide-react';

import { oppositeThemeAppearance, resolveThemeAppearance } from './theme-utils';
import { useTheme } from './ThemeProvider';

const headerIconButtonClassName =
  'bg-transparent text-chatroom-text-secondary w-8 h-8 flex items-center justify-center cursor-pointer transition-all duration-100 hover:bg-chatroom-bg-hover hover:text-chatroom-text-primary outline-none focus:outline-none focus-visible:outline-none';

export function ThemeToggleButton() {
  const { theme, setTheme, isThemeReady } = useTheme();
  const appearance = resolveThemeAppearance(theme);
  const next = oppositeThemeAppearance(appearance);

  return (
    <button
      type="button"
      className={headerIconButtonClassName}
      disabled={!isThemeReady}
      title={next === 'dark' ? 'Switch to dark mode' : 'Switch to light mode'}
      aria-label={next === 'dark' ? 'Switch to dark mode' : 'Switch to light mode'}
      onClick={() => setTheme(next)}
    >
      {appearance === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
    </button>
  );
}
