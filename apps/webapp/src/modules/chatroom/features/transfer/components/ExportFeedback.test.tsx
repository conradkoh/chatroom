import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { ExportFeedback } from './ExportFeedback';

import type { Feedback } from '@/components/inline-feedback';

const success: Feedback = {
  id: 1,
  tone: 'success',
  message: 'Exported “Alpha” to chatroom-chr-1-20260102T030405Z.json.',
};

const failure: Feedback = {
  id: 2,
  tone: 'error',
  title: 'Export failed',
  message: 'This chatroom changed while exporting. Try again.',
};

describe('ExportFeedback', () => {
  it('renders nothing while idle with no feedback', () => {
    const { container } = render(
      <ExportFeedback
        exporting={false}
        label="Exporting “Alpha”…"
        feedback={null}
        onDismiss={() => {}}
        data-testid="chatroom-export-feedback"
      />
    );

    expect(container).toBeEmptyDOMElement();
  });

  it('announces the running export with a status line', () => {
    render(
      <ExportFeedback
        exporting
        label="Exporting “Alpha”…"
        feedback={null}
        onDismiss={() => {}}
        data-testid="chatroom-export-feedback"
      />
    );

    expect(screen.getByRole('status')).toHaveTextContent('Exporting “Alpha”…');
  });

  it('renders the success feedback and dismisses it', async () => {
    const user = userEvent.setup();
    const onDismiss = vi.fn();
    render(
      <ExportFeedback
        exporting={false}
        label="Exporting “Alpha”…"
        feedback={success}
        onDismiss={onDismiss}
        data-testid="chatroom-export-feedback"
      />
    );

    expect(screen.getByTestId('chatroom-export-feedback')).toHaveTextContent(success.message ?? '');
    await user.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('renders the failure title and message without a retry when none is offered', () => {
    render(
      <ExportFeedback
        exporting={false}
        label="Exporting “Alpha”…"
        feedback={failure}
        onDismiss={() => {}}
        data-testid="chatroom-export-feedback"
      />
    );

    expect(screen.getByText('Export failed')).toBeInTheDocument();
    expect(screen.getByText(failure.message ?? '')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
  });

  it('offers Try again only when onRetry is passed', async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    render(
      <ExportFeedback
        exporting={false}
        label="Exporting “Alpha”…"
        feedback={failure}
        onDismiss={() => {}}
        onRetry={onRetry}
        data-testid="chatroom-export-feedback"
      />
    );

    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
