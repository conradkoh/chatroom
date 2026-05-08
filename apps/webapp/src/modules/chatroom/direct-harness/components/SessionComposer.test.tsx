import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { SessionComposer } from './SessionComposer';

const mockSend = vi.fn();
const mockUseSendMessage = vi.fn();

vi.mock('../hooks/useSendMessage', () => ({
  useSendMessage: (...args: unknown[]) => mockUseSendMessage(...args),
}));

const SESSION_ROW_ID = 'sr1' as never;

describe('SessionComposer', () => {
  beforeEach(() => {
    mockSend.mockResolvedValue(undefined);
    mockUseSendMessage.mockReturnValue({ send: mockSend, isSending: false });
  });

  it('renders textarea and send button when status is active', () => {
    render(<SessionComposer sessionRowId={SESSION_ROW_ID} status="active" />);
    expect(screen.getByPlaceholderText(/message/i)).toBeInTheDocument();
    expect(screen.getByRole('button')).toBeInTheDocument();
  });

  it('send button is disabled when text is empty', () => {
    render(<SessionComposer sessionRowId={SESSION_ROW_ID} status="active" />);
    expect(screen.getByRole('button')).toBeDisabled();
  });

  it('calling send clears textarea and invokes hook with correct args', async () => {
    render(<SessionComposer sessionRowId={SESSION_ROW_ID} status="active" />);
    const textarea = screen.getByPlaceholderText(/message/i);
    fireEvent.change(textarea, { target: { value: 'test prompt' } });
    fireEvent.click(screen.getByRole('button'));
    await waitFor(() => {
      expect(mockSend).toHaveBeenCalledWith({
        harnessSessionId: SESSION_ROW_ID,
        text: 'test prompt',
      });
    });
    expect((textarea as HTMLTextAreaElement).value).toBe('');
  });

  it('renders status banner instead of input when status is closed', () => {
    render(<SessionComposer sessionRowId={SESSION_ROW_ID} status="closed" />);
    expect(screen.getByText(/closed/i)).toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/message/i)).not.toBeInTheDocument();
  });
});
