import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { FunctionReference } from 'convex/server';
import { getFunctionName } from 'convex/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MachineList } from './MachineList';
import type { MachineRowModel } from '../hooks/useMachineRows';

import type { MachineUsage } from '@/hooks/useMachineUsage';

const mocks = vi.hoisted(() => ({
  capabilities: undefined as
    | Record<string, { availableHarnesses: string[]; harnessVersions: Record<string, never> }>
    | undefined,
  setMachineAlias: vi.fn(),
  deleteMachine: vi.fn(),
}));

vi.mock('convex-helpers/react/sessions', () => ({
  useSessionQuery: (query: unknown, args?: { machineId?: string } | 'skip') => {
    const name = getFunctionName(query as FunctionReference<'query'>);
    if (name === 'machines:getMachineCapabilities') {
      return mocks.capabilities?.[(args as { machineId?: string })?.machineId ?? ''];
    }
    if (name === 'machineProjectRoots:list') return { roots: [] };
    if (name === 'folderPickerRequests:get') return undefined;
    throw new Error(`Unexpected query: ${name}`);
  },
  useSessionMutation: (mutation: unknown) => {
    const name = getFunctionName(mutation as FunctionReference<'mutation'>);
    if (name === 'machines:setMachineAlias') return mocks.setMachineAlias;
    if (name === 'machines:deleteMachine') return mocks.deleteMachine;
    throw new Error(`Unexpected mutation: ${name}`);
  },
}));

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const REGISTERED_AT = Date.UTC(2026, 10, 3, 12);
const THREE_HOURS_AGO = Date.now() - 3 * 3600_000;

function makeRow(overrides: Partial<MachineRowModel> = {}): MachineRowModel {
  const machine = {
    machineId: 'machine-1',
    hostname: 'studio-mac',
    os: 'darwin',
    registeredAt: REGISTERED_AT,
    ...overrides.machine,
  };
  return {
    machine,
    displayName: machine.alias || machine.hostname,
    connected: true,
    lastSeenAt: undefined,
    usage: undefined,
    ...overrides,
  };
}

const USAGE: MachineUsage = {
  activeWorkspaceCount: 3,
  activeChatroomCount: 2,
  capped: false,
};

function renderRow(row: MachineRowModel) {
  return render(<MachineList rows={[row]} expandedMachineId={null} onToggle={() => {}} />);
}

describe('MachineList / MachineCard', () => {
  beforeEach(() => {
    mocks.capabilities = {};
    mocks.setMachineAlias.mockReset();
    mocks.setMachineAlias.mockResolvedValue({ success: true });
    mocks.deleteMachine.mockReset();
    mocks.deleteMachine.mockResolvedValue({
      status: 'deleted',
      purgeComplete: true,
      detachedWorkspaceCount: 0,
      affectedChatroomCount: 0,
    });
  });

  it('shows Online for a connected machine', () => {
    renderRow(makeRow({ connected: true }));

    const status = screen.getByTestId('machine-status');
    expect(status.textContent).toBe('Online');
    expect(status.className).toContain('text-chatroom-status-success');
  });

  it('shows Checking… while connectivity is unresolved and never Offline', () => {
    renderRow(makeRow({ connected: undefined }));

    expect(screen.getByTestId('machine-status').textContent).toBe('Checking…');
    expect(screen.queryByText('Offline')).toBeNull();
  });

  it('shows Offline with a relative last seen for an offline machine', () => {
    renderRow(makeRow({ connected: false, lastSeenAt: THREE_HOURS_AGO }));

    expect(screen.getByTestId('machine-status').textContent).toBe('Offline');
    expect(screen.getByText(/last seen 3 hours ago/)).toBeDefined();
  });

  it('shows "last seen unknown" when the offline machine has no liveness record', () => {
    renderRow(makeRow({ connected: false, lastSeenAt: null }));

    expect(screen.getByText(/last seen unknown/)).toBeDefined();
  });

  it('omits last seen while the last-seen query is still loading', () => {
    renderRow(makeRow({ connected: false, lastSeenAt: undefined }));

    expect(screen.queryByText(/last seen/)).toBeNull();
  });

  it('shows the friendly OS label, hostname and registered date', () => {
    renderRow(makeRow({ connected: true }));

    expect(screen.getByText('macOS')).toBeDefined();
    expect(within(screen.getByTestId('machine-meta')).getByText('studio-mac')).toBeDefined();
    expect(screen.getByText(/Registered Nov 3, 2026/)).toBeDefined();
  });

  it('shows the usage summary in both responsive slots', () => {
    renderRow(makeRow({ connected: true, usage: USAGE }));

    expect(screen.getByTestId('machine-usage').textContent).toBe('3 workspaces · 2 chatrooms');
    expect(screen.getByTestId('machine-usage-inline').textContent).toBe(
      '3 workspaces · 2 chatrooms'
    );
  });

  it('marks capped usage counts with a plus', () => {
    renderRow(
      makeRow({
        connected: true,
        usage: { activeWorkspaceCount: 500, activeChatroomCount: 120, capped: true },
      })
    );

    expect(screen.getByTestId('machine-usage').textContent).toBe(
      '500+ workspaces · 120+ chatrooms'
    );
  });

  it('renders harness chips and dims them for offline machines', () => {
    mocks.capabilities = {
      'machine-1': { availableHarnesses: ['opencode', 'claude'], harnessVersions: {} },
    };
    renderRow(makeRow({ connected: false, lastSeenAt: null }));

    const chips = screen.getAllByTestId('machine-harness-chip');
    expect(chips.map((chip) => chip.textContent)).toEqual(['opencode', 'claude']);
    expect(screen.getByTestId('machine-harness-chips').className).toContain('opacity-60');
  });

  it('does not dim harness chips for online machines', () => {
    mocks.capabilities = {
      'machine-1': { availableHarnesses: ['opencode'], harnessVersions: {} },
    };
    renderRow(makeRow({ connected: true }));

    expect(screen.getByTestId('machine-harness-chips').className).not.toContain('opacity-60');
  });

  it('renders no chips when the machine reports none', () => {
    mocks.capabilities = { 'machine-1': { availableHarnesses: [], harnessVersions: {} } };
    renderRow(makeRow({ connected: true }));

    expect(screen.queryByTestId('machine-harness-chips')).toBeNull();
    expect(screen.queryByTestId('machine-harness-chip')).toBeNull();
  });

  async function openActions() {
    const user = userEvent.setup();
    await user.click(screen.getByTestId('machine-actions-trigger'));
    await screen.findAllByRole('menuitem');
    return user;
  }

  it('starts the inline alias editor from the Rename action', async () => {
    renderRow(makeRow({ connected: true }));
    const user = await openActions();

    await user.click(screen.getByTestId('machine-action-rename'));

    const input = await screen.findByTestId('machine-alias-input');
    await waitFor(() => expect(input).toHaveFocus());
  });

  it('opens the blocked delete dialog for an online machine', async () => {
    renderRow(makeRow({ connected: true, usage: USAGE }));
    const user = await openActions();

    await user.click(screen.getByTestId('machine-action-delete'));

    expect(await screen.findByTestId('delete-machine-blocked')).toBeInTheDocument();
    expect(screen.queryByTestId('delete-machine-confirm')).toBeNull();
  });

  it('opens the confirm dialog for an offline machine once usage has loaded', async () => {
    renderRow(makeRow({ connected: false, usage: USAGE }));
    const user = await openActions();

    await user.click(screen.getByTestId('machine-action-delete'));

    expect(await screen.findByTestId('delete-machine-confirm-body')).toBeInTheDocument();
    expect(screen.getByTestId('delete-machine-confirm')).toBeEnabled();
  });

  it('keeps the delete action disabled while connectivity is unresolved', async () => {
    renderRow(makeRow({ connected: undefined, usage: USAGE }));
    const user = await openActions();

    await user.click(screen.getByTestId('machine-action-delete'));

    expect(await screen.findByTestId('delete-machine-confirm')).toBeDisabled();
  });
});
