import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useSyncExternalStore } from 'react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

import {
  CommandDialogProvider,
  useCommandDialog,
  useCommandDialogActions,
  useCommandDialogState,
} from './CommandDialogContext';
import {
  getCommandPaletteOpen,
  resetCommandPalette,
  subscribeCommandPaletteOpen,
} from './commandPaletteController';

let mockPathname = '/app/chatroom';
vi.mock('next/navigation', () => ({
  usePathname: () => mockPathname,
}));

function SwitcherProbe() {
  const { activeDialog, openDialog } = useCommandDialog();
  return (
    <div>
      <span data-testid="active">{activeDialog ?? 'null'}</span>
      <button type="button" onClick={() => openDialog('switcher')}>
        open
      </button>
    </div>
  );
}

function PaletteProbe() {
  const { openCommandPalette } = useCommandDialogActions();
  const paletteOpen = useSyncExternalStore(
    subscribeCommandPaletteOpen,
    getCommandPaletteOpen,
    () => false
  );
  const { activeDialog } = useCommandDialogState();
  return (
    <div>
      <span data-testid="active">{activeDialog ?? 'null'}</span>
      <span data-testid="palette-open">{paletteOpen ? 'open' : 'closed'}</span>
      <button type="button" onClick={() => openCommandPalette()}>
        open-palette
      </button>
    </div>
  );
}

describe('CommandDialogProvider route reset', () => {
  beforeEach(() => {
    mockPathname = '/app/chatroom';
    resetCommandPalette();
  });

  afterEach(() => {
    resetCommandPalette();
  });

  it('resets activeDialog when pathname changes', async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <CommandDialogProvider>
        <SwitcherProbe />
      </CommandDialogProvider>
    );
    await user.click(screen.getByRole('button', { name: 'open' }));
    expect(screen.getByTestId('active')).toHaveTextContent('switcher');

    mockPathname = '/app';
    rerender(
      <CommandDialogProvider>
        <SwitcherProbe />
      </CommandDialogProvider>
    );
    expect(screen.getByTestId('active')).toHaveTextContent('null');
  });

  it('does not reset activeDialog on rerender with same pathname', async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <CommandDialogProvider>
        <SwitcherProbe />
      </CommandDialogProvider>
    );
    await user.click(screen.getByRole('button', { name: 'open' }));
    expect(screen.getByTestId('active')).toHaveTextContent('switcher');

    rerender(
      <CommandDialogProvider>
        <SwitcherProbe />
      </CommandDialogProvider>
    );
    expect(screen.getByTestId('active')).toHaveTextContent('switcher');
  });

  it('openCommandPalette does not change activeDialog', async () => {
    const user = userEvent.setup();
    render(
      <CommandDialogProvider>
        <PaletteProbe />
      </CommandDialogProvider>
    );
    await user.click(screen.getByRole('button', { name: 'open-palette' }));
    expect(screen.getByTestId('active')).toHaveTextContent('null');
    expect(screen.getByTestId('palette-open')).toHaveTextContent('open');
  });

  it('openDialog(switcher) closes palette', async () => {
    const user = userEvent.setup();

    function MutualExclusivityProbe() {
      const { activeDialog, openDialog } = useCommandDialog();
      const { openCommandPalette } = useCommandDialogActions();
      const paletteOpen = useSyncExternalStore(
        subscribeCommandPaletteOpen,
        getCommandPaletteOpen,
        () => false
      );
      return (
        <div>
          <span data-testid="active">{activeDialog ?? 'null'}</span>
          <span data-testid="palette-open">{paletteOpen ? 'open' : 'closed'}</span>
          <button type="button" onClick={() => openCommandPalette()}>
            open-palette
          </button>
          <button type="button" onClick={() => openDialog('switcher')}>
            open-switcher
          </button>
        </div>
      );
    }

    render(
      <CommandDialogProvider>
        <MutualExclusivityProbe />
      </CommandDialogProvider>
    );

    await user.click(screen.getByRole('button', { name: 'open-palette' }));
    expect(screen.getByTestId('palette-open')).toHaveTextContent('open');

    await user.click(screen.getByRole('button', { name: 'open-switcher' }));
    expect(screen.getByTestId('palette-open')).toHaveTextContent('closed');
    expect(screen.getByTestId('active')).toHaveTextContent('switcher');
  });
});
