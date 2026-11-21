import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useDashboardWorkspaceRefresh } from './useDashboardWorkspaceRefresh';

import { InlineFeedback } from '@/components/inline-feedback';
import { useCopyOwnedFeedback } from '@/hooks/useCopyOwnedFeedback';

const REFRESH_COOLDOWN_MS = 5000;
const WORKSPACE = { machineId: 'machine-1', workingDir: '/work' };
const IN_PROGRESS = 'Refresh already in progress — please wait a moment';

const requestGitRefresh = vi.fn();

interface Workspace {
  machineId: string | undefined;
  workingDir: string | undefined;
}

/** Mirrors the dashboard wiring: one strip, one refresh handler. */
function RefreshStripHarness({ workspace = WORKSPACE }: { workspace?: Workspace }) {
  const strip = useCopyOwnedFeedback();
  const refresh = useDashboardWorkspaceRefresh({
    ...workspace,
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

describe('the refresh cooldown boundary', () => {
  let now = 0;

  beforeEach(() => {
    vi.clearAllMocks();
    requestGitRefresh.mockResolvedValue(undefined);
    vi.spyOn(Date, 'now').mockImplementation(() => now);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('a first refresh sends even at clock zero', async () => {
    now = 0;
    render(<RefreshStripHarness />);

    await clickRefresh();

    expect(requestGitRefresh).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(IN_PROGRESS)).not.toBeInTheDocument();
  });

  it.each([
    { secondClickAt: 14999, sends: false },
    { secondClickAt: 15000, sends: true },
  ])(
    'a second refresh at $secondClickAt ms, after a sent refresh at 10000 ms against a 5000 ms cooldown, sends: $sends',
    async ({ secondClickAt, sends }) => {
      now = 10000;
      render(<RefreshStripHarness />);
      await clickRefresh();

      now = secondClickAt;
      await clickRefresh();

      expect(requestGitRefresh).toHaveBeenCalledTimes(sends ? 2 : 1);
      expect(screen.queryByText(IN_PROGRESS) !== null).toBe(!sends);
    }
  );
});

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
    expect(screen.getByText(IN_PROGRESS)).toBeInTheDocument();
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

  it('a skipped refresh with no workspace sends nothing and does not start the cooldown', async () => {
    const { rerender } = render(
      <RefreshStripHarness workspace={{ machineId: undefined, workingDir: undefined }} />
    );

    await clickRefresh();

    expect(requestGitRefresh).not.toHaveBeenCalled();
    expect(screen.queryByTestId('dashboard-feedback')).not.toBeInTheDocument();

    rerender(<RefreshStripHarness />);
    await clickRefresh();

    expect(requestGitRefresh).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(IN_PROGRESS)).not.toBeInTheDocument();
  });

  it('a failed refresh does not block the next click', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    requestGitRefresh.mockRejectedValueOnce(new Error('backend down'));
    render(<RefreshStripHarness />);
    await clickRefresh();
    expect(screen.getByText('Failed to refresh workspace state')).toBeInTheDocument();

    await clickRefresh(); // same instant, still inside the cooldown window

    expect(requestGitRefresh).toHaveBeenCalledTimes(2);
    expect(screen.queryByText(IN_PROGRESS)).not.toBeInTheDocument();
    expect(screen.queryByTestId('dashboard-feedback')).not.toBeInTheDocument();
  });

  it('a refresh still in flight blocks a second click at the same instant', async () => {
    let finish!: () => void;
    requestGitRefresh.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        finish = resolve;
      })
    );
    render(<RefreshStripHarness />);
    await clickRefresh();

    await clickRefresh();

    expect(requestGitRefresh).toHaveBeenCalledTimes(1);
    expect(screen.getByText(IN_PROGRESS)).toBeInTheDocument();
    await act(async () => finish());
  });

  it('a refresh still in flight blocks a click after the cooldown window has passed', async () => {
    let finish!: () => void;
    requestGitRefresh.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        finish = resolve;
      })
    );
    render(<RefreshStripHarness />);
    await clickRefresh();

    now += REFRESH_COOLDOWN_MS + 1000;
    await clickRefresh();

    expect(requestGitRefresh).toHaveBeenCalledTimes(1);
    expect(screen.getByText(IN_PROGRESS)).toBeInTheDocument();
    await act(async () => finish());
  });
});
