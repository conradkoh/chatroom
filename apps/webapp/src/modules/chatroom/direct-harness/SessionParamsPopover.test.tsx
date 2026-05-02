import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { SessionParamsPopover } from './SessionParamsPopover';

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockUpdateSessionConfig = vi.fn().mockResolvedValue(undefined);
const mockUseSessionQuery = vi.fn();
const mockUseSessionMutation = vi.fn(() => mockUpdateSessionConfig);

vi.mock('convex-helpers/react/sessions', () => ({
  useSessionQuery: (...args: unknown[]) => mockUseSessionQuery(...args),
  useSessionMutation: (...args: unknown[]) => mockUseSessionMutation(...(args as [])),
}));

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const HARNESSES = [
  {
    name: 'my-harness',
    displayName: 'My Harness',
    configSchema: {},
    agents: [
      { name: 'builder', mode: 'primary' as const },
      { name: 'planner', mode: 'primary' as const },
    ],
    providers: [
      {
        providerID: 'openai',
        name: 'OpenAI',
        models: [{ modelID: 'gpt-4o', name: 'GPT-4o' }],
      },
    ],
  },
];

const SESSION_ROW_ID = 'sr1' as never;
const WORKSPACE_ID = 'ws1' as never;

const defaultConfig = {
  agent: 'builder',
  model: undefined,
  system: undefined,
  tools: undefined,
};

function renderPopover(config = defaultConfig) {
  mockUseSessionQuery.mockReturnValue(HARNESSES);
  return render(
    <SessionParamsPopover
      harnessSessionRowId={SESSION_ROW_ID}
      workspaceId={WORKSPACE_ID}
      harnessName="my-harness"
      lastUsedConfig={config}
    />
  );
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('SessionParamsPopover', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseSessionMutation.mockReturnValue(mockUpdateSessionConfig);
  });

  it('renders trigger button with current agent label', () => {
    renderPopover();
    expect(screen.getByRole('button', { name: /builder/i })).toBeInTheDocument();
  });

  it('hydrates agent from lastUsedConfig when popover opens', async () => {
    renderPopover({ agent: 'planner', model: undefined, system: undefined, tools: undefined });
    fireEvent.click(screen.getByRole('button', { name: /planner/i }));
    await waitFor(() => {
      // Agent select should show planner
      expect(screen.getAllByText('planner').length).toBeGreaterThan(0);
    });
  });

  it('calls updateSessionConfig with merged config on Apply', async () => {
    renderPopover();
    // Open popover
    fireEvent.click(screen.getByRole('button', { name: /builder/i }));
    await waitFor(() => screen.getByText('Apply'));

    // Click Apply with default values
    fireEvent.click(screen.getByText('Apply'));
    await waitFor(() => {
      expect(mockUpdateSessionConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          harnessSessionRowId: SESSION_ROW_ID,
          config: expect.objectContaining({ agent: 'builder' }),
        })
      );
    });
  });

  it('blocks Apply when no agent is resolved', async () => {
    // Return harness with no eligible agents
    mockUseSessionQuery.mockReturnValue([
      { ...HARNESSES[0], agents: [{ name: 'sub', mode: 'subagent' as const }] },
    ]);
    render(
      <SessionParamsPopover
        harnessSessionRowId={SESSION_ROW_ID}
        workspaceId={WORKSPACE_ID}
        harnessName="my-harness"
        lastUsedConfig={{ agent: '', model: undefined, system: undefined, tools: undefined }}
      />
    );
    // Trigger label is empty agent
    const trigger = screen.getByRole('button');
    fireEvent.click(trigger);
    await waitFor(() => {
      const applyBtn = screen.getByText('Apply');
      expect(applyBtn.closest('button')).toBeDisabled();
    });
  });
});
