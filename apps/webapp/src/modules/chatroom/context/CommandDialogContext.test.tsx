import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi, beforeEach } from 'vitest';

import { CommandDialogProvider, useCommandDialog } from './CommandDialogContext';

let mockPathname = '/app/chatroom';
vi.mock('next/navigation', () => ({
  usePathname: () => mockPathname,
}));

function Probe() {
  const { activeDialog, openDialog } = useCommandDialog();
  return (
    <div>
      <span data-testid="active">{activeDialog ?? 'null'}</span>
      <button type="button" onClick={() => openDialog('command-palette')}>
        open
      </button>
    </div>
  );
}

describe('CommandDialogProvider route reset', () => {
  beforeEach(() => {
    mockPathname = '/app/chatroom';
  });

  it('resets activeDialog when pathname changes', async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <CommandDialogProvider>
        <Probe />
      </CommandDialogProvider>
    );
    await user.click(screen.getByRole('button', { name: 'open' }));
    expect(screen.getByTestId('active')).toHaveTextContent('command-palette');

    mockPathname = '/app';
    rerender(
      <CommandDialogProvider>
        <Probe />
      </CommandDialogProvider>
    );
    expect(screen.getByTestId('active')).toHaveTextContent('null');
  });

  it('does not reset activeDialog on rerender with same pathname', async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <CommandDialogProvider>
        <Probe />
      </CommandDialogProvider>
    );
    await user.click(screen.getByRole('button', { name: 'open' }));
    expect(screen.getByTestId('active')).toHaveTextContent('command-palette');

    rerender(
      <CommandDialogProvider>
        <Probe />
      </CommandDialogProvider>
    );
    expect(screen.getByTestId('active')).toHaveTextContent('command-palette');
  });
});
