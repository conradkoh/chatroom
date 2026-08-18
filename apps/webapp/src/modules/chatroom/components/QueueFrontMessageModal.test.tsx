import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { QueueFrontMessageModal } from './QueueFrontMessageModal';

describe('QueueFrontMessageModal', () => {
  it('renders the queue-front title and disables submit for empty content', () => {
    render(<QueueFrontMessageModal isOpen onClose={vi.fn()} onSubmit={vi.fn()} />);
    expect(screen.getByText('Add to Front of Queue')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add to Queue' })).toBeDisabled();
  });
});
