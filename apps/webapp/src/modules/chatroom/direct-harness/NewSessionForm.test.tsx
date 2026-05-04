import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { NewSessionForm } from './NewSessionForm';

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockUseSessionQuery = vi.fn();
const mockUseSessionMutation = vi.fn();
const mockOpenSession = vi.fn();
const mockRequestRefresh = vi.fn();

vi.mock('convex-helpers/react/sessions', () => ({
  useSessionQuery: (...args: unknown[]) => mockUseSessionQuery(...args),
  useSessionMutation: (...args: unknown[]) => mockUseSessionMutation(...args),
}));

vi.mock('@workspace/backend/convex/_generated/api', () => ({
  api: {
    chatroom: {
      directHarness: {
        capabilities: {
          listForWorkspace: 'mock:listForWorkspace',
          requestRefresh: 'mock:requestRefresh',
        },
        sessions: { openSession: 'mock:openSession' },
      },
    },
  },
}));

const WORKSPACE_ID = 'ws1' as never;

const SAMPLE_HARNESS = {
  name: 'opencode-sdk',
  displayName: 'Opencode',
  agents: [
    {
      name: 'builder',
      mode: 'primary' as const,
      model: { providerID: 'openai', modelID: 'gpt-4o' },
    },
    { name: 'subagent', mode: 'subagent' as const },
  ],
  providers: [
    {
      providerID: 'openai',
      name: 'OpenAI',
      models: [
        { modelID: 'gpt-4o', name: 'GPT-4o' },
        { modelID: 'gpt-4o-mini', name: 'GPT-4o Mini' },
      ],
    },
  ],
};

async function openForm() {
  const trigger = screen.getByRole('button', { name: /new session/i });
  fireEvent.click(trigger);
  await screen.findByRole('dialog');
}

describe('NewSessionForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockOpenSession.mockResolvedValue({ harnessSessionRowId: 'sess1' });
    mockRequestRefresh.mockResolvedValue({ taskId: 'task-1' });
    mockUseSessionMutation.mockImplementation((key: string) => {
      if (key === 'mock:requestRefresh') return mockRequestRefresh;
      return mockOpenSession;
    });
  });

  it('renders trigger button even when capabilities query returns undefined', () => {
    mockUseSessionQuery.mockReturnValue(undefined);
    render(<NewSessionForm workspaceId={WORKSPACE_ID} onSessionCreated={vi.fn()} />);
    expect(screen.getByRole('button', { name: /new session/i })).toBeInTheDocument();
  });

  it('renders trigger button when capabilities query returns empty array', () => {
    mockUseSessionQuery.mockReturnValue([]);
    render(<NewSessionForm workspaceId={WORKSPACE_ID} onSessionCreated={vi.fn()} />);
    expect(screen.getByRole('button', { name: /new session/i })).toBeInTheDocument();
  });

  it('harness Select is always present in the form', async () => {
    mockUseSessionQuery.mockReturnValue([SAMPLE_HARNESS]);
    render(<NewSessionForm workspaceId={WORKSPACE_ID} onSessionCreated={vi.fn()} />);
    await openForm();
    // The harness select trigger should be present (ShadCN Select renders a button trigger)
    const triggers = screen.getAllByRole('combobox');
    expect(triggers.length).toBeGreaterThanOrEqual(1);
  });

  it('submit calls openSession with the expected arg shape', async () => {
    mockUseSessionQuery.mockReturnValue([SAMPLE_HARNESS]);
    const onSessionCreated = vi.fn();
    render(<NewSessionForm workspaceId={WORKSPACE_ID} onSessionCreated={onSessionCreated} />);
    await openForm();

    // Type first message
    const textarea = screen.getByPlaceholderText(/what would you like to do/i);
    fireEvent.change(textarea, { target: { value: 'Hello world' } });

    const submitBtn = screen.getByRole('button', { name: /create & send/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(mockOpenSession).toHaveBeenCalledWith(
        expect.objectContaining({
          workspaceId: WORKSPACE_ID,
          harnessName: 'opencode-sdk',
          config: expect.objectContaining({ agent: 'builder' }),
          firstPrompt: { parts: [{ type: 'text', text: 'Hello world' }] },
        })
      );
    });

    await waitFor(() => {
      expect(onSessionCreated).toHaveBeenCalledWith('sess1');
    });
  });

  it('submit button is disabled while request is pending', async () => {
    mockUseSessionQuery.mockReturnValue([SAMPLE_HARNESS]);
    let resolveOpen!: (v: { harnessSessionRowId: string }) => void;
    const pending = new Promise<{ harnessSessionRowId: string }>((res) => {
      resolveOpen = res;
    });
    mockOpenSession.mockReturnValue(pending);

    render(<NewSessionForm workspaceId={WORKSPACE_ID} onSessionCreated={vi.fn()} />);
    await openForm();

    const textarea = screen.getByPlaceholderText(/what would you like to do/i);
    fireEvent.change(textarea, { target: { value: 'Hello' } });

    const submitBtn = screen.getByRole('button', { name: /create & send/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /creating/i })).toBeDisabled();
    });

    resolveOpen({ harnessSessionRowId: 'sess1' });
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });

  it('empty first message blocks submit', async () => {
    mockUseSessionQuery.mockReturnValue([SAMPLE_HARNESS]);
    render(<NewSessionForm workspaceId={WORKSPACE_ID} onSessionCreated={vi.fn()} />);
    await openForm();

    const submitBtn = screen.getByRole('button', { name: /create & send/i });
    expect(submitBtn).toBeDisabled();

    // whitespace-only also blocked
    const textarea = screen.getByPlaceholderText(/what would you like to do/i);
    fireEvent.change(textarea, { target: { value: '   ' } });
    expect(submitBtn).toBeDisabled();
  });

  it('empty agent list: shows text input and allows submit with default agent', async () => {
    const noAgentHarness = { ...SAMPLE_HARNESS, agents: [] };
    mockUseSessionQuery.mockReturnValue([noAgentHarness]);
    render(<NewSessionForm workspaceId={WORKSPACE_ID} onSessionCreated={vi.fn()} />);
    await openForm();

    // Agent text input is shown (not a disabled message)
    const agentInput = screen.getByPlaceholderText('builder');
    expect(agentInput).toBeInTheDocument();
    expect(screen.getByText(/agent list will populate/i)).toBeInTheDocument();

    // Submit is enabled with default "builder" agent + a message
    const textarea = screen.getByPlaceholderText(/what would you like to do/i);
    fireEvent.change(textarea, { target: { value: 'Hello' } });

    const submitBtn = screen.getByRole('button', { name: /create & send/i });
    expect(submitBtn).not.toBeDisabled();
  });

  it('auto-fires a refresh when the dialog opens', async () => {
    mockUseSessionQuery.mockReturnValue([SAMPLE_HARNESS]);
    render(<NewSessionForm workspaceId={WORKSPACE_ID} onSessionCreated={vi.fn()} />);
    await openForm();

    await waitFor(() => {
      expect(mockRequestRefresh).toHaveBeenCalledWith({ workspaceId: WORKSPACE_ID });
    });
  });
});
