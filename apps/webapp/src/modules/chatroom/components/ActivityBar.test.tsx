import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ActivityBar } from './ActivityBar';

const { openDialogMock, closeDialogMock, stateMock } = vi.hoisted(() => ({
  openDialogMock: vi.fn(),
  closeDialogMock: vi.fn(),
  stateMock: vi.fn(),
}));

vi.mock('../context/CommandDialogContext', () => ({
  // Note: no toggleCommandPalette here — if ActivityBar regresses to palette
  // wiring, the render throws (undefined function call), failing this suite.
  useCommandDialogState: () => stateMock(),
  useCommandDialogActions: () => ({
    openDialog: openDialogMock,
    closeDialog: closeDialogMock,
  }),
}));

function renderActivityBar() {
  return render(<ActivityBar activeView="explorer" onViewChange={() => {}} />);
}

describe('ActivityBar bottom button (Go to File)', () => {
  beforeEach(() => {
    stateMock.mockReturnValue({ activeDialog: null });
    openDialogMock.mockClear();
    closeDialogMock.mockClear();
  });

  it('opens file-selector on click when no dialog is open', () => {
    renderActivityBar();

    fireEvent.click(screen.getByTitle('Go to File'));

    expect(openDialogMock).toHaveBeenCalledTimes(1);
    expect(openDialogMock).toHaveBeenCalledWith('file-selector');
    expect(closeDialogMock).not.toHaveBeenCalled();
  });

  it('closes file-selector when it is already open', () => {
    stateMock.mockReturnValue({ activeDialog: 'file-selector' });
    renderActivityBar();

    fireEvent.click(screen.getByTitle('Go to File'));

    expect(closeDialogMock).toHaveBeenCalledTimes(1);
    expect(openDialogMock).not.toHaveBeenCalled();
  });

  it('does not open the command palette', () => {
    renderActivityBar();

    fireEvent.click(screen.getByTitle('Go to File'));

    // The context mock provides no palette actions; the click must route to
    // file-selector only.
    expect(openDialogMock).toHaveBeenCalledWith('file-selector');
    expect(openDialogMock.mock.calls[0]?.[0]).not.toBe('command-palette');
  });
});
