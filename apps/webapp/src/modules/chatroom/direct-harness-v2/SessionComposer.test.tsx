import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockUseSessionMutation = vi.fn();

vi.mock('convex-helpers/react/sessions', () => ({
  useSessionMutation: (...args: unknown[]) => mockUseSessionMutation(...args),
}));

import { SessionComposer } from './SessionComposer';

const SESSION_ROW_ID = 'sr1' as never;

describe('SessionComposer', () => {
  beforeEach(() => {
    // Default: mutation returns a no-op function
    mockUseSessionMutation.mockReturnValue(vi.fn().mockResolvedValue({}));
  });

  it('renders textarea and send button when status is active', () => {
    render(<SessionComposer sessionRowId={SESSION_ROW_ID} status="active" />);
    expect(screen.getByPlaceholderText(/send a prompt/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /send/i })).toBeInTheDocument();
  });

  it('send button is disabled when text is empty', () => {
    render(<SessionComposer sessionRowId={SESSION_ROW_ID} status="active" />);
    const sendButton = screen.getByRole('button', { name: /send/i });
    expect(sendButton).toBeDisabled();
  });

  it('calling send clears textarea and invokes mutation with correct args', async () => {
    const mockMutationFn = vi.fn().mockResolvedValue({});
    mockUseSessionMutation.mockReturnValue(mockMutationFn);

    render(<SessionComposer sessionRowId={SESSION_ROW_ID} status="active" />);

    const textarea = screen.getByPlaceholderText(/send a prompt/i);
    fireEvent.change(textarea, { target: { value: 'hello world' } });

    const sendButton = screen.getByRole('button', { name: /send/i });
    expect(sendButton).not.toBeDisabled();
    fireEvent.click(sendButton);

    await waitFor(() => {
      expect(mockMutationFn).toHaveBeenCalledWith({
        harnessSessionRowId: SESSION_ROW_ID,
        parts: [{ type: 'text', text: 'hello world' }],
      });
    });

    await waitFor(() => {
      expect((textarea as HTMLTextAreaElement).value).toBe('');
    });
  });

  it('renders status banner instead of input when status is closed', () => {
    render(<SessionComposer sessionRowId={SESSION_ROW_ID} status="closed" />);
    expect(screen.queryByPlaceholderText(/send a prompt/i)).not.toBeInTheDocument();
    expect(screen.getByText(/session is closed/i)).toBeInTheDocument();
  });
});
