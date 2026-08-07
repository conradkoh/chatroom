import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ActivityBar } from './ActivityBar';

const toggleCommandPaletteMock = vi.fn();

vi.mock('../context/CommandDialogContext', () => ({
  useCommandDialogActions: () => ({
    toggleCommandPalette: toggleCommandPaletteMock,
  }),
}));

vi.mock('../context/commandPaletteController', () => ({
  subscribeCommandPaletteOpen: () => () => {},
  getCommandPaletteOpen: () => false,
}));

function renderActivityBar() {
  return render(<ActivityBar activeView="explorer" onViewChange={() => {}} />);
}

describe('ActivityBar bottom button (Command Palette)', () => {
  beforeEach(() => {
    toggleCommandPaletteMock.mockClear();
  });

  it('toggles command palette on click', () => {
    renderActivityBar();

    fireEvent.click(screen.getByTitle('Command Palette'));

    expect(toggleCommandPaletteMock).toHaveBeenCalledTimes(1);
  });

  it('does not open the file selector', () => {
    renderActivityBar();

    fireEvent.click(screen.getByTitle('Command Palette'));

    expect(toggleCommandPaletteMock).toHaveBeenCalled();
  });
});
