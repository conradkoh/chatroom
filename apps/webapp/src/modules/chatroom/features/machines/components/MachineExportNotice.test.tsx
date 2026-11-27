import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { MachineExportNotice } from './MachineExportNotice';
import type { MachineExportAction } from '../../transfer/hooks/useMachineExportAction';
import { EXPORT_CANCELLED_COPY, MACHINE_EMPTY_COPY } from '../../transfer/lib/transferCopy';

import type { Feedback } from '@/components/inline-feedback';

function makeAction(overrides: Partial<MachineExportAction> = {}): MachineExportAction {
  return {
    phase: { kind: 'idle' },
    feedback: null,
    retryable: false,
    start: vi.fn(),
    cancel: vi.fn(),
    dismiss: vi.fn(),
    ...overrides,
  };
}

const incomplete: Feedback = {
  id: 1,
  tone: 'error',
  title: 'Export incomplete — no file was saved',
  message: '2 of 12 chatrooms could not be exported:',
  items: ['Alpha', 'Beta'],
};

describe('MachineExportNotice', () => {
  it('renders nothing while idle with no feedback', () => {
    const { container } = render(<MachineExportNotice action={makeAction()} />);

    expect(container).toBeEmptyDOMElement();
  });

  it('shows the listing phase with a cancel button', async () => {
    const user = userEvent.setup();
    const action = makeAction({ phase: { kind: 'listing' } });
    render(<MachineExportNotice action={action} />);

    expect(screen.getByRole('status')).toHaveTextContent('Finding chatrooms on this machine…');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(action.cancel).toHaveBeenCalledTimes(1);
  });

  it('shows progress for the chatroom being written, capped at the total', () => {
    render(
      <MachineExportNotice
        action={makeAction({ phase: { kind: 'exporting', done: 0, total: 3 } })}
      />
    );

    expect(screen.getByRole('status')).toHaveTextContent('Exporting 1 of 3 chatrooms…');
    const bar = screen.getByRole('progressbar', { name: 'Export progress' });
    expect(bar).toHaveAttribute('aria-valuenow', '0');
    expect(bar).toHaveAttribute('aria-valuemax', '3');
  });

  it('shows the empty-machine information', () => {
    render(
      <MachineExportNotice
        action={makeAction({ feedback: { id: 1, tone: 'info', message: MACHINE_EMPTY_COPY } })}
      />
    );

    expect(screen.getByTestId('machine-export-feedback')).toHaveTextContent(MACHINE_EMPTY_COPY);
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
  });

  it('shows the saved file name with its item lines', () => {
    render(
      <MachineExportNotice
        action={makeAction({
          feedback: {
            id: 1,
            tone: 'success',
            message: 'Saved chatroom-all-machine-1-20260102T030405Z.json',
            items: ['2 chatrooms', '2 attachments not included (2 KB)'],
          },
        })}
      />
    );

    expect(
      screen.getByText('Saved chatroom-all-machine-1-20260102T030405Z.json')
    ).toBeInTheDocument();
    expect(screen.getByText('2 chatrooms')).toBeInTheDocument();
    expect(screen.getByText('2 attachments not included (2 KB)')).toBeInTheDocument();
  });

  it('lists the failed chatroom names and retries an incomplete export', async () => {
    const user = userEvent.setup();
    const action = makeAction({ feedback: incomplete, retryable: true });
    render(<MachineExportNotice action={action} />);

    expect(screen.getByText('Export incomplete — no file was saved')).toBeInTheDocument();
    expect(screen.getByText('2 of 12 chatrooms could not be exported:')).toBeInTheDocument();
    expect(screen.getByText('Alpha')).toBeInTheDocument();
    expect(screen.getByText('Beta')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(action.start).toHaveBeenCalledTimes(1);
  });

  it('shows the cancelled information without a retry', () => {
    render(
      <MachineExportNotice
        action={makeAction({ feedback: { id: 1, tone: 'info', message: EXPORT_CANCELLED_COPY } })}
      />
    );

    expect(screen.getByText(EXPORT_CANCELLED_COPY)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
  });

  it('hides Try again when the failure is not retryable', () => {
    render(
      <MachineExportNotice
        action={makeAction({
          feedback: { id: 1, tone: 'error', title: 'Export failed', message: 'too large' },
          retryable: false,
        })}
      />
    );

    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
  });
});
