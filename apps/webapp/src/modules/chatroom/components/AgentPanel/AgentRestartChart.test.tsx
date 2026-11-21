import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentRestartChart } from './AgentRestartChart';

const sessionQuery = vi.hoisted(() => {
  const EMPTY: never[] = [];
  return { calls: [] as unknown[], EMPTY };
});

vi.mock('convex-helpers/react/sessions', () => ({
  // Records the args of every query call. The Convex client is the port here.
  useSessionQuery: (_query: unknown, args: unknown) => {
    sessionQuery.calls.push(args);
    return sessionQuery.EMPTY;
  },
}));

vi.mock('@workspace/backend/convex/_generated/api', () => ({
  api: { machines: { getAgentRestartMetrics: 'machines.getAgentRestartMetrics' } },
}));

// recharts is a rendering library. Stub it so the chart area is inert in jsdom.
vi.mock('recharts', () => {
  const Stub = () => null;
  return {
    BarChart: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
    Bar: Stub,
    XAxis: Stub,
    YAxis: Stub,
    Tooltip: Stub,
    LabelList: Stub,
    ResponsiveContainer: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  };
});

function renderChart() {
  return render(<AgentRestartChart machineId="machine-1" chatroomId="room-1" role="builder" />);
}

/** The args of the most recent query call. */
function lastArgs(): { startTime: number; endTime: number } {
  return sessionQuery.calls.at(-1) as { startTime: number; endTime: number };
}

function startInput() {
  return screen.getByTestId('restart-chart-start');
}

function endInput() {
  return screen.getByTestId('restart-chart-end');
}

beforeEach(() => {
  sessionQuery.calls.length = 0;
  // Fixed "now" so the default 3d range is deterministic: start 2026-11-18, end 2026-11-21.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 10, 21, 12, 0, 0));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('AgentRestartChart date range', () => {
  it('stores the typed start day as local midnight', () => {
    renderChart();

    fireEvent.change(startInput(), { target: { value: '2026-11-01' } });

    expect(lastArgs().startTime).toBe(new Date(2026, 10, 1, 0, 0, 0).getTime());
  });

  it('stores the typed end day as local 23:59:59', () => {
    renderChart();

    fireEvent.change(endInput(), { target: { value: '2026-11-10' } });

    expect(lastArgs().endTime).toBe(new Date(2026, 10, 10, 23, 59, 59).getTime());
  });

  it('clears the preset highlight after a custom edit', () => {
    renderChart();

    fireEvent.change(startInput(), { target: { value: '2026-11-01' } });

    for (const label of ['3d', '7d', '30d']) {
      expect(screen.getByRole('button', { name: label }).className).not.toContain('bg-accent/50');
    }
  });

  it('resets both fields and highlights the preset when 7d is clicked', () => {
    renderChart();

    fireEvent.change(startInput(), { target: { value: '2026-11-01' } });
    // A real click on the preset blurs the text input first, committing the typed value.
    fireEvent.blur(startInput());
    fireEvent.click(screen.getByRole('button', { name: '7d' }));

    expect(startInput()).toHaveValue('2026-11-14');
    expect(endInput()).toHaveValue('2026-11-21');
    expect(screen.getByRole('button', { name: '7d' }).className).toContain('bg-accent/50');
  });

  it('ignores invalid and partial text and snaps back to the applied date on blur', () => {
    renderChart();
    const initialArgs = lastArgs();

    fireEvent.change(startInput(), { target: { value: '2026-13-40' } });
    fireEvent.change(startInput(), { target: { value: '2026-11-0' } });

    expect(lastArgs().startTime).toBe(initialArgs.startTime);
    expect(lastArgs().endTime).toBe(initialArgs.endTime);

    fireEvent.blur(startInput());
    expect(startInput()).toHaveValue('2026-11-18');
  });

  it('keeps the preset when the already-selected day is picked', async () => {
    renderChart();

    fireEvent.click(screen.getByTestId('restart-chart-start-calendar'));
    fireEvent.click(await screen.findByRole('button', { name: /November 18/ }));

    expect(screen.getByRole('button', { name: '3d' }).className).toContain('bg-accent/50');
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /November 18/ })).not.toBeInTheDocument()
    );
  });

  it('lays the control row out with wrapping compact fields', () => {
    renderChart();

    const start = startInput();
    const row = start.closest('.flex-wrap');

    expect(row).not.toBeNull();
    expect(row?.contains(endInput())).toBe(true);
    expect(start.className).toContain('h-6');
    expect(start.parentElement?.className).toContain('w-[6.5rem]');
  });
});
