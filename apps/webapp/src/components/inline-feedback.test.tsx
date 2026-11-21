import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { InlineFeedback } from './inline-feedback';

describe('InlineFeedback', () => {
  it('renders nothing and reserves no space when feedback is null', () => {
    const { container } = render(<InlineFeedback feedback={null} />);

    expect(container).toBeEmptyDOMElement();
  });

  it.each([
    ['error', 'alert'],
    ['warning', 'status'],
    ['success', 'status'],
    ['info', 'status'],
  ] as const)('renders tone %s with role %s', (tone, role) => {
    render(<InlineFeedback feedback={{ id: 1, tone, message: 'Message' }} />);

    expect(screen.getByRole(role)).toHaveTextContent('Message');
  });

  it('renders title, message and items', () => {
    render(
      <InlineFeedback
        feedback={{
          id: 1,
          tone: 'error',
          title: 'Partial failure',
          message: 'Restart failed for 2 agents',
          items: ['builder: timeout', 'reviewer: offline'],
        }}
      />
    );

    expect(screen.getByText('Partial failure')).toBeInTheDocument();
    expect(screen.getByText('Restart failed for 2 agents')).toBeInTheDocument();
    expect(screen.getByText('builder: timeout')).toBeInTheDocument();
    expect(screen.getByText('reviewer: offline')).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
  });

  it('shows the icon by default', () => {
    const { container } = render(
      <InlineFeedback feedback={{ id: 1, tone: 'error', message: 'Failed' }} />
    );

    expect(container.querySelector('svg')).not.toBeNull();
  });

  it('hides the icon when icon={false}', () => {
    const { container } = render(
      <InlineFeedback feedback={{ id: 1, tone: 'error', message: 'Failed' }} icon={false} />
    );

    expect(container.querySelector('svg')).toBeNull();
  });

  it('hides the icon when feedback.icon is false and the prop is absent', () => {
    const { container } = render(
      <InlineFeedback feedback={{ id: 1, tone: 'error', message: 'Failed', icon: false }} />
    );

    expect(container.querySelector('svg')).toBeNull();
  });

  it('lets icon={true} override feedback.icon: false', () => {
    const { container } = render(
      <InlineFeedback
        feedback={{ id: 1, tone: 'error', message: 'Failed', icon: false }}
        icon={true}
      />
    );

    expect(container.querySelector('svg')).not.toBeNull();
  });

  it('renders a working Dismiss button only when onDismiss is provided', async () => {
    const user = userEvent.setup();
    const onDismiss = vi.fn();

    const { rerender } = render(
      <InlineFeedback
        feedback={{ id: 1, tone: 'error', message: 'Failed' }}
        onDismiss={onDismiss}
      />
    );

    await user.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(onDismiss).toHaveBeenCalledTimes(1);

    rerender(<InlineFeedback feedback={{ id: 1, tone: 'error', message: 'Failed' }} />);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('keeps Dismiss Tab-reachable without focusing it on mount', async () => {
    const user = userEvent.setup();

    render(
      <InlineFeedback feedback={{ id: 1, tone: 'error', message: 'Failed' }} onDismiss={() => {}} />
    );

    expect(screen.getByRole('button', { name: 'Dismiss' })).not.toHaveFocus();

    await user.tab();
    expect(screen.getByRole('button', { name: 'Dismiss' })).toHaveFocus();
  });

  it('re-announces the same message when the feedback id changes', () => {
    const { rerender } = render(
      <InlineFeedback feedback={{ id: 1, tone: 'error', message: 'Failed' }} />
    );
    const first = screen.getByRole('alert');

    rerender(<InlineFeedback feedback={{ id: 2, tone: 'error', message: 'Failed' }} />);
    const second = screen.getByRole('alert');

    expect(second).not.toBe(first);
    expect(second).toHaveTextContent('Failed');
  });

  it('renders the text variant as a plain paragraph without a border', () => {
    render(<InlineFeedback variant="text" feedback={{ id: 1, tone: 'info', message: 'Saved' }} />);

    const node = screen.getByRole('status');

    expect(node.tagName).toBe('P');
    expect(node).toHaveTextContent('Saved');
    expect(node).not.toHaveClass('border');
  });

  it('uses a status token colour instead of a hard-coded colour', () => {
    render(<InlineFeedback feedback={{ id: 1, tone: 'error', message: 'Failed' }} />);

    expect(screen.getByRole('alert')).toHaveClass('text-chatroom-status-error');
  });

  it('applies className to the root element', () => {
    render(
      <InlineFeedback feedback={{ id: 1, tone: 'error', message: 'Failed' }} className="mt-4" />
    );

    expect(screen.getByRole('alert')).toHaveClass('mt-4');
  });
});
