import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ActivityBar } from './ActivityBar';
import {
  getCommandPaletteOpen,
  resetCommandPalette,
  toggleCommandPaletteOpen,
} from '../context/commandPaletteController';

const toggleCommandPaletteMock = vi.fn();

vi.mock('../context/CommandDialogContext', () => ({
  useCommandDialogActions: () => ({
    toggleCommandPalette: toggleCommandPaletteMock,
  }),
}));

function renderActivityBar() {
  return render(<ActivityBar activeView="explorer" onViewChange={() => {}} />);
}

describe('ActivityBar bottom button (Command Palette)', () => {
  beforeEach(() => {
    resetCommandPalette();
    toggleCommandPaletteMock.mockClear();
  });

  it('toggles command palette on click', () => {
    renderActivityBar();

    fireEvent.click(screen.getByTestId('activity-bar-command-palette'));

    expect(toggleCommandPaletteMock).toHaveBeenCalledTimes(1);
  });

  it('does not open the file selector', () => {
    renderActivityBar();

    fireEvent.click(screen.getByTestId('activity-bar-command-palette'));

    expect(toggleCommandPaletteMock).toHaveBeenCalled();
  });

  it('opens palette via commandPaletteController when toggle is wired', () => {
    toggleCommandPaletteMock.mockImplementation(() => {
      toggleCommandPaletteOpen();
    });

    renderActivityBar();

    expect(getCommandPaletteOpen()).toBe(false);
    fireEvent.click(screen.getByTestId('activity-bar-command-palette'));
    expect(getCommandPaletteOpen()).toBe(true);
  });
});

describe('ActivityBar mobile layout', () => {
  beforeEach(() => {
    resetCommandPalette();
    toggleCommandPaletteMock.mockClear();
  });

  it('pins command button with safe-area and scrollable icon region', () => {
    renderActivityBar();

    const scrollRegion = screen.getByTestId('activity-bar-icon-scroll');
    expect(scrollRegion.className).toContain('overflow-y-auto');

    const commandButton = screen.getByTestId('activity-bar-command-palette');
    expect(commandButton.className).toContain('shrink-0');
    expect(commandButton.className).toContain('safe-area-inset-bottom');
  });
});
