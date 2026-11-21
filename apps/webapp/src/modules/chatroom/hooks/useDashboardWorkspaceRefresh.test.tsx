import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useDashboardWorkspaceRefresh } from './useDashboardWorkspaceRefresh';

import { InlineFeedback } from '@/components/inline-feedback';
import { useCopyOwnedFeedback } from '@/hooks/useCopyOwnedFeedback';

const REFRESH_COOLDOWN_MS = 5000;
const WORKSPACE = { machineId: 'machine-1', workingDir: '/work' };

const requestGitRefresh = vi.fn();

/** Mirrors the dashboard wiring: one strip, one refresh handler. */
function RefreshStripHarness() {
  const strip = useCopyOwnedFeedback();
  const refresh = useDashboardWorkspaceRefresh({
    ...WORKSPACE,
    requestGitRefresh,
    report: strip.report,
    cooldownMs: REFRESH_COOLDOWN_MS,
  });
  return (
    <>
      <InlineFeedback
        feedback={strip.feedback}
        onDismiss={strip.clear}
        data-testid="dashboard-feedback"
        className="m-2 shrink-0"
      />
      <button onClick={() => void refresh()}>Refresh</button>
    </>
  );
}

async function clickRefresh() {
  fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
  await act(async () => {});
}

describe('useDashboardWorkspaceRefresh', () => {
  let now = 5000;

  beforeEach(() => {
    vi.clearAllMocks();
    requestGitRefresh.mockResolvedValue(undefined);
    now = 5000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('a successful refresh sends the request and shows nothing', async () => {
    render(<RefreshStripHarness />);

    await clickRefresh();

    expect(requestGitRefresh).toHaveBeenCalledTimes(1);
    expect(requestGitRefresh).toHaveBeenCalledWith({
      machineId: 'machine-1',
      workingDir: '/work',
    });
    expect(screen.queryByTestId('dashboard-feedback')).not.toBeInTheDocument();
  });

  it('a refresh inside the cooldown window reports an info notice and sends nothing', async () => {
    render(<RefreshStripHarness />);
    await clickRefresh();

    now += 2000;
    await clickRefresh();

    const box = screen.getByTestId('dashboard-feedback');
    expect(box).toHaveAttribute('role', 'status');
    expect(
      screen.getByText('Refresh already in progress — please wait a moment')
    ).toBeInTheDocument();
    expect(requestGitRefresh).toHaveBeenCalledTimes(1);
  });

  it('a refresh after the cooldown window sends again and clears the info notice', async () => {
    render(<RefreshStripHarness />);
    await clickRefresh();

    now += 2000;
    await clickRefresh();
    expect(screen.getByTestId('dashboard-feedback')).toBeInTheDocument();

    now += 4000;
    await clickRefresh();

    expect(requestGitRefresh).toHaveBeenCalledTimes(2);
    expect(screen.queryByTestId('dashboard-feedback')).not.toBeInTheDocument();
  });

  it('a rejected refresh reports an error notice and logs the error', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    requestGitRefresh.mockRejectedValueOnce(new Error('backend down'));
    render(<RefreshStripHarness />);

    await clickRefresh();

    const box = screen.getByTestId('dashboard-feedback');
    expect(box).toHaveAttribute('role', 'alert');
    expect(screen.getByText('Failed to refresh workspace state')).toBeInTheDocument();
    expect(errorSpy).toHaveBeenCalled();
  });

  it('a successful refresh after a failure clears the error box', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    requestGitRefresh.mockRejectedValueOnce(new Error('backend down'));
    render(<RefreshStripHarness />);
    await clickRefresh();
    expect(screen.getByTestId('dashboard-feedback')).toBeInTheDocument();

    now += 6000;
    await clickRefresh();

    expect(screen.queryByTestId('dashboard-feedback')).not.toBeInTheDocument();
    expect(requestGitRefresh).toHaveBeenCalledTimes(2);
  });

  it('Dismiss removes the failure box', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    requestGitRefresh.mockRejectedValueOnce(new Error('backend down'));
    render(<RefreshStripHarness />);
    await clickRefresh();

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));

    expect(screen.queryByTestId('dashboard-feedback')).not.toBeInTheDocument();
  });
});
