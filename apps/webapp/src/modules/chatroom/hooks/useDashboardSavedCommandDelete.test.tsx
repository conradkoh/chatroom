import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useDashboardSavedCommandDelete } from './useDashboardSavedCommandDelete';

import { InlineFeedback } from '@/components/inline-feedback';
import { useCopyOwnedFeedback } from '@/hooks/useCopyOwnedFeedback';

const deleteSavedCommand = vi.fn();

/** Mirrors the dashboard wiring: one strip, one confirmed delete. */
function DeleteStripHarness() {
  const strip = useCopyOwnedFeedback();
  const handleDelete = useDashboardSavedCommandDelete({
    deleteSavedCommand,
    report: strip.report,
  });
  return (
    <>
      <InlineFeedback
        feedback={strip.feedback}
        onDismiss={strip.clear}
        data-testid="dashboard-feedback"
        className="m-2 shrink-0"
      />
      <button onClick={() => void handleDelete('cmd-1')}>Delete</button>
    </>
  );
}

async function clickDelete() {
  fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
  await act(async () => {});
}

describe('useDashboardSavedCommandDelete', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    deleteSavedCommand.mockResolvedValue(undefined);
  });

  it('a resolved delete sends the request and shows nothing', async () => {
    render(<DeleteStripHarness />);

    await clickDelete();

    expect(deleteSavedCommand).toHaveBeenCalledTimes(1);
    expect(deleteSavedCommand).toHaveBeenCalledWith({ commandId: 'cmd-1' });
    expect(screen.queryByTestId('dashboard-feedback')).not.toBeInTheDocument();
  });

  it('a rejected delete reports an error notice in the strip', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    deleteSavedCommand.mockRejectedValueOnce(new Error('backend down'));
    render(<DeleteStripHarness />);

    await clickDelete();

    const box = screen.getByTestId('dashboard-feedback');
    expect(box).toHaveAttribute('role', 'alert');
    expect(screen.getByText('Failed to delete command. Please try again.')).toBeInTheDocument();
  });

  it('the next successful delete clears the error box', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    deleteSavedCommand.mockRejectedValueOnce(new Error('backend down'));
    render(<DeleteStripHarness />);
    await clickDelete();
    expect(screen.getByTestId('dashboard-feedback')).toBeInTheDocument();

    await clickDelete();

    expect(screen.queryByTestId('dashboard-feedback')).not.toBeInTheDocument();
    expect(deleteSavedCommand).toHaveBeenCalledTimes(2);
  });
});
