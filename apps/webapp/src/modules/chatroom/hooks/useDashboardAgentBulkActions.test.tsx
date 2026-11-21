import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useDashboardAgentBulkActions } from './useDashboardAgentBulkActions';

import { InlineFeedback } from '@/components/inline-feedback';
import { useCopyOwnedFeedback } from '@/hooks/useCopyOwnedFeedback';

const mocks = vi.hoisted(() => ({ start: vi.fn(), stop: vi.fn(), restart: vi.fn() }));

vi.mock('./useChatroomAgentOperations', () => ({
  useChatroomAgentOperations: () => ({
    startAgents: mocks.start,
    stopAgents: mocks.stop,
    restartAgents: mocks.restart,
  }),
}));

const PURE_SUCCESS = { requested: [{ role: 'planner' }], skipped: [], failed: [] };

/** Mirrors the dashboard wiring: one strip, one set of bulk actions. */
function DashboardStripHarness() {
  const strip = useCopyOwnedFeedback();
  const actions = useDashboardAgentBulkActions({
    chatroomId: 'room-1',
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
      <button onClick={() => void actions.stopAllRemoteAgents()}>Stop all</button>
      <button onClick={() => void actions.restartAllRemoteAgents()}>Restart all</button>
    </>
  );
}

describe('useDashboardAgentBulkActions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.start.mockResolvedValue(PURE_SUCCESS);
    mocks.stop.mockResolvedValue(PURE_SUCCESS);
    mocks.restart.mockResolvedValue(PURE_SUCCESS);
  });

  it('a fully successful stop renders no dashboard feedback', async () => {
    render(<DashboardStripHarness />);

    fireEvent.click(screen.getByRole('button', { name: 'Stop all' }));
    await act(async () => {});

    expect(screen.queryByTestId('dashboard-feedback')).not.toBeInTheDocument();
  });

  it('a fully successful restart renders no dashboard feedback', async () => {
    render(<DashboardStripHarness />);

    fireEvent.click(screen.getByRole('button', { name: 'Restart all' }));
    await act(async () => {});

    expect(screen.queryByTestId('dashboard-feedback')).not.toBeInTheDocument();
  });

  it('a partial restart lists its failed agents', async () => {
    mocks.restart.mockResolvedValue({
      requested: [{ role: 'planner' }],
      skipped: [],
      failed: [{ role: 'builder', error: 'Machine offline' }],
    });
    render(<DashboardStripHarness />);

    fireEvent.click(screen.getByRole('button', { name: 'Restart all' }));
    const box = await screen.findByTestId('dashboard-feedback');

    expect(box).toHaveAttribute('role', 'alert');
    expect(within(box).getByText('Failed to restart 1 agent(s)')).toBeInTheDocument();
    expect(within(box).getByText('Restart requested for 1 agent(s)')).toBeInTheDocument();
    expect(within(box).getAllByRole('listitem')).toHaveLength(1);
    expect(within(box).getByText('builder: Machine offline')).toBeInTheDocument();
  });

  it('a total stop failure lists every failed agent with no requested line', async () => {
    mocks.stop.mockResolvedValue({
      requested: [],
      skipped: [],
      failed: [{ role: 'builder', error: 'Machine offline' }],
    });
    render(<DashboardStripHarness />);

    fireEvent.click(screen.getByRole('button', { name: 'Stop all' }));
    const box = await screen.findByTestId('dashboard-feedback');

    expect(box).toHaveAttribute('role', 'alert');
    expect(within(box).getByText('Failed to stop 1 agent(s)')).toBeInTheDocument();
    expect(within(box).getByText('builder: Machine offline')).toBeInTheDocument();
    expect(within(box).queryByText(/Stop requested/)).not.toBeInTheDocument();
  });

  it('a rejected stop shows the error message as an alert', async () => {
    mocks.stop.mockRejectedValueOnce(new Error('backend down'));
    render(<DashboardStripHarness />);

    fireEvent.click(screen.getByRole('button', { name: 'Stop all' }));
    const box = await screen.findByTestId('dashboard-feedback');

    expect(box).toHaveAttribute('role', 'alert');
    expect(within(box).getByText('backend down')).toBeInTheDocument();
  });

  it('Dismiss removes a partial failure', async () => {
    mocks.restart.mockResolvedValue({
      requested: [{ role: 'planner' }],
      skipped: [],
      failed: [{ role: 'builder', error: 'Machine offline' }],
    });
    render(<DashboardStripHarness />);

    fireEvent.click(screen.getByRole('button', { name: 'Restart all' }));
    await screen.findByTestId('dashboard-feedback');

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));

    expect(screen.queryByTestId('dashboard-feedback')).not.toBeInTheDocument();
  });

  it('the next agent action clears the previous feedback before its result', async () => {
    mocks.restart.mockResolvedValueOnce({
      requested: [{ role: 'planner' }],
      skipped: [],
      failed: [{ role: 'builder', error: 'Machine offline' }],
    });
    let resolveStop: (value: typeof PURE_SUCCESS) => void = () => {};
    mocks.stop.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveStop = resolve;
        })
    );
    render(<DashboardStripHarness />);

    fireEvent.click(screen.getByRole('button', { name: 'Restart all' }));
    await screen.findByTestId('dashboard-feedback');

    fireEvent.click(screen.getByRole('button', { name: 'Stop all' }));
    expect(screen.queryByTestId('dashboard-feedback')).not.toBeInTheDocument();

    await act(async () => {
      resolveStop(PURE_SUCCESS);
    });
    expect(screen.queryByTestId('dashboard-feedback')).not.toBeInTheDocument();
  });
});
