import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AgenticQueryPanel } from './AgenticQueryPanel';

const mockSubmit = vi.fn();
const mockUseAgenticQuery = vi.fn();

vi.mock('../hooks/useAgenticQuery', () => ({
  useAgenticQuery: (...args: unknown[]) => mockUseAgenticQuery(...args),
}));

vi.mock('@/modules/chatroom/direct-harness/hooks/useHarnessTurnStore', () => ({
  useHarnessTurnStore: () => ({
    turns: [],
    streamingOverlay: null,
    isLoading: false,
  }),
}));

describe('AgenticQueryPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSubmit.mockResolvedValue(undefined);
    mockUseAgenticQuery.mockReturnValue({
      query: { status: 'draft', mode: 'search', title: 'Agentic Search' },
      turns: [],
      isLoading: false,
      isRunning: false,
      isDraft: true,
      canFollowUp: false,
      canSubmit: true,
      harnessSessionId: undefined,
      submit: mockSubmit,
    });
  });

  it('submits a draft query from the primary input', async () => {
    render(<AgenticQueryPanel queryId="query-1" mode="search" workspaceId="ws-1" />);

    fireEvent.change(screen.getByPlaceholderText(/Search the codebase/i), {
      target: { value: 'find auth handlers' },
    });
    fireEvent.click(screen.getByTestId('agentic-query-submit'));

    await waitFor(() => {
      expect(mockSubmit).toHaveBeenCalledWith('find auth handlers');
    });
  });

  it('shows follow-up input when query can be refined', () => {
    mockUseAgenticQuery.mockReturnValue({
      query: { status: 'complete', mode: 'ask', title: 'How auth works' },
      turns: [
        {
          _id: 'turn-1',
          seq: 0,
          userMessage: 'How auth works?',
          assistantResponse: '## Summary\n\nAuth uses sessions.',
          createdAt: 1,
        },
      ],
      isLoading: false,
      isRunning: false,
      isDraft: false,
      canFollowUp: true,
      canSubmit: false,
      harnessSessionId: undefined,
      submit: mockSubmit,
    });

    render(<AgenticQueryPanel queryId="query-1" mode="ask" workspaceId="ws-1" />);

    expect(screen.getByTestId('agentic-query-follow-up')).toBeInTheDocument();
    expect(screen.getByText(/Auth uses sessions/i)).toBeInTheDocument();
  });
});
