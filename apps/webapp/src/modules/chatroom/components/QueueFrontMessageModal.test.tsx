import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { QueueFrontMessageModal } from './QueueFrontMessageModal';

vi.mock('next/dynamic', () => ({
  default: () =>
    function MockRichTextEditor({
      value,
      onChange,
    }: {
      value: string;
      onChange: (value: string) => void;
    }) {
      return (
        <textarea aria-label="Message" value={value} onChange={(e) => onChange(e.target.value)} />
      );
    },
}));

const typeMessage = (text: string) =>
  fireEvent.change(screen.getByRole('textbox', { name: 'Message' }), {
    target: { value: text },
  });

describe('QueueFrontMessageModal', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders the queue-front title and disables submit for empty content', () => {
    render(<QueueFrontMessageModal isOpen onClose={vi.fn()} onSubmit={vi.fn()} />);
    expect(screen.getByText('Add to Front of Queue')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add to Queue' })).toBeDisabled();
  });

  it('shows the failure inside the modal and keeps the typed message', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const onClose = vi.fn();
    const onSubmit = vi.fn().mockRejectedValue(new Error('network down'));
    render(<QueueFrontMessageModal isOpen onClose={onClose} onSubmit={onSubmit} />);

    typeMessage('urgent work');
    fireEvent.click(screen.getByRole('button', { name: 'Add to Queue' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Failed to add message to front of queue'
    );
    expect(screen.getByRole('textbox', { name: 'Message' })).toHaveValue('urgent work');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('closes without any message when the submit succeeds', async () => {
    const onClose = vi.fn();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<QueueFrontMessageModal isOpen onClose={onClose} onSubmit={onSubmit} />);

    typeMessage('urgent work');
    fireEvent.click(screen.getByRole('button', { name: 'Add to Queue' }));

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(onSubmit).toHaveBeenCalledWith('urgent work');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('dismisses the failure with its Dismiss button and keeps the typed message', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const onSubmit = vi.fn().mockRejectedValue(new Error('network down'));
    render(<QueueFrontMessageModal isOpen onClose={vi.fn()} onSubmit={onSubmit} />);

    typeMessage('urgent work');
    fireEvent.click(screen.getByRole('button', { name: 'Add to Queue' }));
    await screen.findByRole('alert');

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Message' })).toHaveValue('urgent work');
  });

  it('clears the failure as soon as the message is edited', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const onSubmit = vi.fn().mockRejectedValue(new Error('network down'));
    render(<QueueFrontMessageModal isOpen onClose={vi.fn()} onSubmit={onSubmit} />);

    typeMessage('urgent work');
    fireEvent.click(screen.getByRole('button', { name: 'Add to Queue' }));
    await screen.findByRole('alert');

    typeMessage('urgent work, revised');

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
