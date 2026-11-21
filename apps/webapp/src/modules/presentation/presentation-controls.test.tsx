import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PresentationControls } from './presentation-controls';

const mocks = vi.hoisted(() => ({ context: undefined as unknown }));

vi.mock('./presentation-container', () => ({
  usePresentationContext: () => mocks.context,
}));

function makeContext() {
  return {
    currentSlide: 3,
    totalSlides: 10,
    previousSlide: vi.fn(),
    nextSlide: vi.fn(),
    isFullScreen: false,
    controlsVisible: true,
    toggleFullScreen: vi.fn(),
    isPresenter: false,
    isPresentationActive: false,
    isSoloMode: true,
    startPresenting: vi.fn(),
    stopPresenting: vi.fn(),
    followPresenter: vi.fn(),
  };
}

beforeEach(() => {
  mocks.context = makeContext();
});

afterEach(() => {
  vi.restoreAllMocks();
});

/**
 * The info dialog is rendered inside an overlay marked `aria-hidden`, so its
 * controls must be queried with `hidden: true`.
 */
const IN_DIALOG = { hidden: true } as const;

/** Opens the info dialog via its info icon button. */
async function openInfoDialog(user: ReturnType<typeof userEvent.setup>) {
  const infoButton = document.querySelector('.lucide-info')?.closest('button');
  if (!infoButton) throw new Error('info button not found');
  await user.click(infoButton);
}

describe('PresentationControls share link', () => {
  it('copies the URL with the current slide, shows Link copied with a check for 2 seconds, then reverts', async () => {
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined);
    render(<PresentationControls />);
    await openInfoDialog(user);

    await user.click(screen.getByRole('button', { name: 'Copy shareable link', ...IN_DIALOG }));

    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('slide=3'));
    const copied = await screen.findByRole('button', { name: 'Link copied', ...IN_DIALOG });
    expect(copied.querySelector('.lucide-check')).not.toBeNull();

    await waitFor(
      () =>
        expect(
          screen.getByRole('button', { name: 'Copy shareable link', ...IN_DIALOG })
        ).toBeInTheDocument(),
      { timeout: 3000 }
    );
  });

  it('shows the manual-copy message when the copy is rejected, and clears it on the next copy', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {}); // the hook logs the rejection
    const user = userEvent.setup();
    vi.spyOn(navigator.clipboard, 'writeText')
      .mockRejectedValueOnce(new Error('denied'))
      .mockResolvedValueOnce(undefined);
    render(<PresentationControls />);
    await openInfoDialog(user);

    await user.click(screen.getByRole('button', { name: 'Copy shareable link', ...IN_DIALOG }));

    const alert = await screen.findByRole('alert', IN_DIALOG);
    expect(alert).toHaveTextContent(
      'Failed to copy. Please copy the URL manually from your address bar'
    );
    expect(
      screen.getByRole('button', { name: 'Copy shareable link', ...IN_DIALOG })
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Copy shareable link', ...IN_DIALOG }));

    await waitFor(() => expect(screen.queryByRole('alert', IN_DIALOG)).not.toBeInTheDocument());
  });

  it('clears the failure message when the info dialog closes', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const user = userEvent.setup();
    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('denied'));
    render(<PresentationControls />);
    await openInfoDialog(user);
    await user.click(screen.getByRole('button', { name: 'Copy shareable link', ...IN_DIALOG }));
    await screen.findByRole('alert', IN_DIALOG);

    await user.click(screen.getByRole('button', { name: '✕', ...IN_DIALOG }));
    expect(
      screen.queryByRole('button', { name: 'Copy shareable link', ...IN_DIALOG })
    ).not.toBeInTheDocument();

    await openInfoDialog(user);
    expect(screen.queryByRole('alert', IN_DIALOG)).not.toBeInTheDocument();
  });
});
