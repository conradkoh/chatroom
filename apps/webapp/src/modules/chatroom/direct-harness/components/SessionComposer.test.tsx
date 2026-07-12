import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { SessionComposer } from './SessionComposer';

const mockSend = vi.fn();
const mockUseSendMessage = vi.fn();

vi.mock('../hooks/useSendMessage', () => ({
  useSendMessage: (...args: unknown[]) => mockUseSendMessage(...args),
}));

// Mock capabilities query + useHarnessConfig so SessionComposer renders without Convex provider
// Controls what useSessionQuery returns — override per test as needed
let mockCapabilities: { machineId: string | null; harnesses: unknown[] } = {
  machineId: null,
  harnesses: [],
};

vi.mock('convex-helpers/react/sessions', () => ({
  // Return capabilities or null (for filter query) based on the api arg shape
  useSessionQuery: (_api: unknown, args: unknown) => {
    // capabilities.listForWorkspace has workspaceId arg; filter query has machineId + agentHarness
    if (args === 'skip') return undefined;
    if (args && typeof args === 'object' && 'workspaceId' in args) return mockCapabilities;
    return null; // getMachineModelFilters — no filter configured
  },
  useSessionMutation: () => vi.fn(),
  useSessionId: () => ['test-session'],
}));

const SESSION_ROW_ID = 'sr1' as never;
const SESSION_WORKSPACE_ID = 'ws1' as never;
const SESSION_HARNESS = 'opencode-sdk';

Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

describe('SessionComposer', () => {
  beforeEach(() => {
    mockSend.mockResolvedValue(undefined);
    mockUseSendMessage.mockReturnValue({ send: mockSend, isSending: false });
    mockCapabilities = { machineId: null, harnesses: [] }; // reset to default
  });

  it('renders textarea and send button when status is active', () => {
    render(
      <SessionComposer
        sessionRowId={SESSION_ROW_ID}
        status="active"
        workspaceId={SESSION_WORKSPACE_ID}
        harnessName={SESSION_HARNESS}
      />
    );
    expect(screen.getByPlaceholderText(/message/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /send message/i })).toBeInTheDocument();
  });

  it('send button is disabled when text is empty', () => {
    render(
      <SessionComposer
        sessionRowId={SESSION_ROW_ID}
        status="active"
        workspaceId={SESSION_WORKSPACE_ID}
        harnessName={SESSION_HARNESS}
      />
    );
    expect(screen.getByRole('button', { name: /send message/i })).toBeDisabled();
  });

  it('calling send clears textarea and invokes hook with correct args', async () => {
    render(
      <SessionComposer
        sessionRowId={SESSION_ROW_ID}
        status="active"
        workspaceId={SESSION_WORKSPACE_ID}
        harnessName={SESSION_HARNESS}
      />
    );
    const textarea = screen.getByPlaceholderText(/message/i);
    fireEvent.change(textarea, { target: { value: 'test prompt' } });
    fireEvent.click(screen.getByRole('button', { name: /send message/i }));
    await waitFor(() => {
      expect(mockSend).toHaveBeenCalledWith({
        harnessSessionId: SESSION_ROW_ID,
        text: 'test prompt',
      });
    });
    expect((textarea as HTMLTextAreaElement).value).toBe('');
  });

  it('renders status banner instead of input when status is closed', () => {
    render(
      <SessionComposer
        sessionRowId={SESSION_ROW_ID}
        status="closed"
        workspaceId={SESSION_WORKSPACE_ID}
        harnessName={SESSION_HARNESS}
      />
    );
    expect(screen.getByText(/closed/i)).toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/message/i)).not.toBeInTheDocument();
  });

  it('model visibility filter button renders when machineId is available', () => {
    // Arrange: capabilities returns a real machineId so useHarnessModelFilter.enabled is true
    mockCapabilities = { machineId: 'm1', harnesses: [] };

    render(
      <SessionComposer
        sessionRowId={SESSION_ROW_ID}
        status="active"
        workspaceId={SESSION_WORKSPACE_ID}
        harnessName={SESSION_HARNESS}
      />
    );

    // The filter button renders when filter.enabled (machineId + harnessName both present)
    expect(screen.getByRole('button', { name: /configure visible models/i })).toBeInTheDocument();
  });
});
