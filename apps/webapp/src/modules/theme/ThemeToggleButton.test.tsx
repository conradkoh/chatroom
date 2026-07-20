import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { ThemeToggleButton } from './ThemeToggleButton';

const mockSetTheme = vi.fn();
let mockTheme: string | null = 'light';
let mockIsThemeReady = true;

vi.mock('./ThemeProvider', () => ({
  useTheme: () => ({
    theme: mockTheme,
    setTheme: mockSetTheme,
    isThemeReady: mockIsThemeReady,
  }),
}));

describe('ThemeToggleButton', () => {
  it('shows Moon icon for light appearance', () => {
    mockTheme = 'light';
    render(<ThemeToggleButton />);
    expect(document.querySelector('.lucide-moon')).not.toBeNull();
    expect(document.querySelector('.lucide-sun')).toBeNull();
  });

  it('shows Sun icon for dark appearance', () => {
    mockTheme = 'dark';
    render(<ThemeToggleButton />);
    expect(document.querySelector('.lucide-sun')).not.toBeNull();
    expect(document.querySelector('.lucide-moon')).toBeNull();
  });

  it('calls setTheme with opposite appearance on click', async () => {
    const user = userEvent.setup();
    mockTheme = 'light';
    mockSetTheme.mockClear();
    render(<ThemeToggleButton />);
    await user.click(screen.getByRole('button'));
    expect(mockSetTheme).toHaveBeenCalledWith('dark');
  });
});
