import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ThemeSettings } from './ThemeSettings';

const mocks = vi.hoisted(() => ({
  setTheme: vi.fn(),
  theme: 'light' as 'light' | 'dark' | 'system',
}));

vi.mock('@/modules/theme/ThemeProvider', () => ({
  useTheme: () => ({ isThemeReady: true, theme: mocks.theme, setTheme: mocks.setTheme }),
}));

beforeEach(() => {
  mocks.setTheme.mockReset();
  mocks.theme = 'light';
});

describe('ThemeSettings', () => {
  it('applies the selected theme and shows no message', async () => {
    const user = userEvent.setup();
    render(<ThemeSettings />);

    await user.click(screen.getByRole('radio', { name: /Dark Theme/ }));

    expect(mocks.setTheme).toHaveBeenCalledWith('dark');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.queryByText(/Theme changed/)).not.toBeInTheDocument();
  });
});
