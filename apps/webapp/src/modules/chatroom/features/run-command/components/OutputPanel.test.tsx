import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { OutputPanel } from './OutputPanel';
import type { CommandRun, OutputChunk } from '../types/run';

vi.mock('./TerminalView', () => ({
  TerminalView: ({ output }: { output: string; children?: ReactNode }) => (
    <div data-testid="terminal-output">{output}</div>
  ),
}));

const run: CommandRun = {
  _id: 'run-1',
  commandName: 'dev',
  script: 'pnpm dev',
  status: 'running',
  startedAt: 1,
};

function chunksFor(lines: string[]): OutputChunk[] {
  return [{ content: lines.join('\n'), chunkIndex: 0 }];
}

function outputLines(count: number, prefix = 'line'): string[] {
  return Array.from({ length: count }, (_, index) => `${prefix}-${index + 1}`);
}

function renderPanel(overrides: Partial<React.ComponentProps<typeof OutputPanel>> = {}) {
  return render(
    <OutputPanel
      run={run}
      chunks={chunksFor(outputLines(101))}
      onStop={vi.fn()}
      onRestart={vi.fn()}
      {...overrides}
    />
  );
}

describe('OutputPanel log head', () => {
  it('shows the formatted head immediately when more output cannot be loaded', async () => {
    const user = userEvent.setup();
    renderPanel({ canLoadMore: false });

    await user.click(screen.getByRole('button', { name: 'Log head' }));

    const terminal = screen.getByTestId('terminal-output');
    expect(terminal).toHaveTextContent('line-1');
    expect(terminal).toHaveTextContent('line-100');
    expect(terminal).not.toHaveTextContent('line-101');
    expect(terminal).toHaveTextContent('… (1 more lines)');
  });

  it('loads full output before showing the formatted head', async () => {
    const user = userEvent.setup();
    const onLoadMore = vi.fn();
    const view = renderPanel({
      chunks: chunksFor(outputLines(10, 'tail')),
      canLoadMore: true,
      onLoadMore,
      fullOutputPending: false,
    });
    onLoadMore.mockImplementation(() => {
      view.rerender(
        <OutputPanel
          run={run}
          chunks={chunksFor(outputLines(10, 'tail'))}
          onStop={vi.fn()}
          onRestart={vi.fn()}
          canLoadMore
          onLoadMore={onLoadMore}
          fullOutputPending
        />
      );
    });

    await user.click(screen.getByRole('button', { name: 'Log head' }));

    expect(onLoadMore).toHaveBeenCalledOnce();
    expect(screen.getAllByText('Loading history…')).not.toHaveLength(0);
    expect(screen.getByRole('button', { name: 'Log head' })).toBeDisabled();

    view.rerender(
      <OutputPanel
        run={run}
        chunks={chunksFor(outputLines(101))}
        onStop={vi.fn()}
        onRestart={vi.fn()}
        canLoadMore
        onLoadMore={onLoadMore}
        fullOutputPending={false}
      />
    );

    await waitFor(() => {
      const terminal = screen.getByTestId('terminal-output');
      expect(terminal).toHaveTextContent('line-1');
      expect(terminal).not.toHaveTextContent('line-101');
      expect(terminal).toHaveTextContent('… (1 more lines)');
    });
  });

  it('resets the log head view when switching runs', async () => {
    const user = userEvent.setup();
    const { rerender } = renderPanel({ canLoadMore: false });

    await user.click(screen.getByRole('button', { name: 'Log head' }));
    expect(screen.getByTestId('terminal-output')).not.toHaveTextContent('line-101');

    const nextRun: CommandRun = { ...run, _id: 'run-2' };
    rerender(
      <OutputPanel
        run={nextRun}
        chunks={chunksFor(['new-live-line'])}
        onStop={vi.fn()}
        onRestart={vi.fn()}
        canLoadMore={false}
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId('terminal-output')).toHaveTextContent('new-live-line');
    });
  });
});
