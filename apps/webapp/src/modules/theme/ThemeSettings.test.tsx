import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { Toaster } from '@/components/ui/sonner';
import { ThemeSettings } from '@/modules/theme/ThemeSettings';

// jsdom does not provide matchMedia (read by the real Toaster).
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

const mocks = vi.hoisted(() => ({
  setTheme: vi.fn(),
  theme: 'light' as 'light' | 'dark' | 'system',
}));

// Theme port: the only mocked boundary. RadioGroup, normalizeTheme and the
// sonner Toaster are all real.
vi.mock('@/modules/theme/ThemeProvider', () => ({
  useTheme: () => ({
    isThemeReady: true,
    theme: mocks.theme,
    setTheme: mocks.setTheme,
  }),
}));

function renderSettings() {
  return render(
    <>
      <ThemeSettings />
      <Toaster />
    </>
  );
}

describe('ThemeSettings', () => {
  beforeEach(() => {
    mocks.setTheme.mockClear();
    mocks.theme = 'light';
  });

  it('shows the theme from the port as the checked option', () => {
    mocks.theme = 'system';
    renderSettings();

    expect(screen.getByRole('radio', { name: /system theme/i })).toBeChecked();
    expect(screen.getByRole('radio', { name: /light theme/i })).not.toBeChecked();
  });

  it('applies the selected theme through the theme port', async () => {
    const user = userEvent.setup();
    renderSettings();

    await user.click(screen.getByRole('radio', { name: /dark theme/i }));

    expect(mocks.setTheme).toHaveBeenCalledWith('dark');
  });

  it('does not show a theme-change toast after selecting a theme', async () => {
    const user = userEvent.setup();
    renderSettings();

    await user.click(screen.getByRole('radio', { name: /dark theme/i }));

    expect(mocks.setTheme).toHaveBeenCalledWith('dark');
    expect(screen.queryByText('Theme changed to dark')).toBeNull();
  });
});
