import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { runExportBundle } from '@workspace/backend/src/domain/usecase/chatroom-transfer/export-bundle';
import type { ChatroomExportPort } from '@workspace/backend/src/domain/usecase/chatroom-transfer/export-driver';
import type { FunctionReference } from 'convex/server';
import { getFunctionName } from 'convex/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MachineList } from './MachineList';
import { MACHINE_EMPTY_COPY } from '../../transfer/lib/transferCopy';
import type { MachineRowModel } from '../hooks/useMachineRows';

import type { MachineUsage } from '@/hooks/useMachineUsage';

const mocks = vi.hoisted(() => ({
  capabilities: undefined as
    | Record<string, { availableHarnesses: string[]; harnessVersions: Record<string, never> }>
    | undefined,
  roots: [{ rootId: 'r1', path: '/Users/me/projects', addedAt: 1 }],
  setMachineAlias: vi.fn(),
  deleteMachine: vi.fn(),
  addRoot: vi.fn(),
  removeRoot: vi.fn(),
  ledgerRequest: vi.fn(),
  ledgerDiscard: vi.fn(),
  backupInventoryRequest: vi.fn(),
  createMany: vi.fn(),
  query: vi.fn(),
}));

vi.mock('convex/react', () => ({
  useConvex: () => ({ query: mocks.query }),
}));

vi.mock('convex-helpers/react/sessions', () => ({
  useSessionId: () => ['session-1'],
  useSessionQuery: (query: unknown, args?: { machineId?: string } | 'skip') => {
    const name = getFunctionName(query as FunctionReference<'query'>);
    if (name === 'machines:getMachineCapabilities') {
      return mocks.capabilities?.[(args as { machineId?: string })?.machineId ?? ''];
    }
    if (name === 'machineProjectRoots:list') return { roots: mocks.roots };
    if (name === 'folderBrowse:get' || name === 'folderBrowse:getListing') return undefined;
    if (name === 'repositoryLedger:get' || name === 'repositoryLedger:listEntries') {
      return undefined;
    }
    if (name === 'machineBackups:getRequest') return undefined;
    if (name === 'machineBackups:getActiveDownload') return null;
    throw new Error(`Unexpected query: ${name}`);
  },
  useSessionMutation: (mutation: unknown) => {
    const name = getFunctionName(mutation as FunctionReference<'mutation'>);
    if (name === 'machines:setMachineAlias') return mocks.setMachineAlias;
    if (name === 'machines:deleteMachine') return mocks.deleteMachine;
    if (name === 'machineProjectRoots:add') return mocks.addRoot;
    if (name === 'machineProjectRoots:remove') return mocks.removeRoot;
    if (name === 'folderBrowse:open') return vi.fn();
    if (name === 'folderBrowse:navigate') return vi.fn();
    if (name === 'folderBrowse:close') return vi.fn();
    if (name === 'repositoryLedger:request') return mocks.ledgerRequest;
    if (name === 'repositoryLedger:discard') return mocks.ledgerDiscard;
    if (name.startsWith('machineBackups:')) {
      return name === 'machineBackups:createInventoryRequest'
        ? mocks.backupInventoryRequest
        : vi.fn();
    }
    if (name === 'chatrooms:createManyWithWorkspace') return mocks.createMany;
    throw new Error(`Unexpected mutation: ${name}`);
  },
  useSessionPaginatedQuery: () => undefined,
}));

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

function renderExpanded(row: MachineRowModel, expandedMachineId: string | null) {
  return render(
    <MachineList rows={[row]} expandedMachineId={expandedMachineId} onToggle={() => {}} />
  );
}

const EXPORT_AT = new Date('2026-01-02T03:04:05.000Z');
const EXPORT_STAMP = {
  lastActivityAt: null,
  nextQueuePosition: null,
  latestMessage: null,
  taskCounts: null,
  latest: {},
  attachmentRows: { count: 0, capped: false, totalBytes: 0 },
};
const EXPORT_PORT: ChatroomExportPort = {
  getStamp: async () => EXPORT_STAMP,
  readPage: async ({ category }) =>
    category === 'room'
      ? {
          rows: [
            {
              id: 'room-1',
              creationTime: 1,
              fields: { status: 'active', name: 'Alpha', teamStructureId: 'duo' },
            },
          ],
          continueCursor: null,
          isDone: true,
        }
      : {
          rows: [
            {
              id: 'message-1',
              creationTime: 2,
              fields: { senderRole: 'user', content: 'hello', type: 'message' },
            },
          ],
          continueCursor: null,
          isDone: true,
        },
};

async function exportFile(): Promise<File> {
  const { json } = await runExportBundle(EXPORT_PORT, {
    chatroomIds: ['src-1'],
    machineId: 'machine-src',
    cliVersion: 'webapp',
    now: () => EXPORT_AT,
  });
  const file = new File([json], 'chatroom-all-export.json', { type: 'application/json' });
  Object.defineProperty(file, 'text', { value: async () => json, configurable: true });
  return file;
}

async function openImportDialog(): Promise<void> {
  const user = userEvent.setup();
  await user.click(screen.getByTestId('machine-actions-trigger'));
  await user.click(await screen.findByTestId('machine-action-import'));
  await screen.findByTestId('import-dialog');
}

async function uploadExport(file: File): Promise<void> {
  await act(async () => {
    fireEvent.change(screen.getByTestId('import-file-input'), { target: { files: [file] } });
  });
}

describe('MachineList / MachineCard', () => {
  beforeEach(() => {
    mocks.capabilities = {};
    mocks.roots = [{ rootId: 'r1', path: '/Users/me/projects', addedAt: 1 }];
    mocks.setMachineAlias.mockReset();
    mocks.setMachineAlias.mockResolvedValue({ success: true });
    mocks.deleteMachine.mockReset();
    mocks.deleteMachine.mockResolvedValue({
      status: 'deleted',
      purgeComplete: true,
      detachedWorkspaceCount: 0,
      affectedChatroomCount: 0,
    });
    mocks.addRoot.mockReset();
    mocks.removeRoot.mockReset();
    mocks.ledgerRequest.mockReset();
    mocks.ledgerDiscard.mockReset();
    mocks.backupInventoryRequest.mockReset();
    mocks.backupInventoryRequest.mockResolvedValue({ requestId: 'backup-req-1', reused: false });
    mocks.createMany.mockReset();
    mocks.query.mockReset();
    mocks.query.mockImplementation(async (ref: { name?: string }) => {
      if (ref.name === 'listForMachine') return [];
      throw new Error(`Unexpected query: ${ref.name}`);
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
      'machine-1': { availableHarnesses: ['opencode-sdk', 'claude-sdk'], harnessVersions: {} },
    };
    renderRow(makeRow({ connected: false, lastSeenAt: null }));

    const chips = screen.getAllByTestId('machine-harness-chip');
    expect(chips.map((chip) => chip.textContent)).toEqual(['opencode-sdk', 'claude-sdk']);
    expect(screen.getByTestId('machine-harness-chips').className).toContain('opacity-60');
  });

  it('does not dim harness chips for online machines', () => {
    mocks.capabilities = {
      'machine-1': { availableHarnesses: ['opencode-sdk'], harnessVersions: {} },
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

  it('shows the repositories section below project roots only while expanded', () => {
    const row = makeRow({ connected: true });
    const { rerender } = renderExpanded(row, 'machine-1');

    const roots = screen.getByTestId('machine-roots-section');
    const repositories = screen.getByTestId('machine-repositories-section');
    expect(roots.compareDocumentPosition(repositories) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING
    );
    expect(within(repositories).getByTestId('ledger-load')).toBeEnabled();

    rerender(<MachineList rows={[row]} expandedMachineId={null} onToggle={() => {}} />);

    expect(screen.queryByTestId('machine-repositories-section')).toBeNull();
  });

  it('renders no export notice until an export starts', () => {
    renderRow(makeRow({ connected: true }));

    expect(screen.queryByTestId('machine-export-notice')).toBeNull();
  });

  it('mounts the Backups section only while expanded and sends nothing until Check backups', async () => {
    const row = makeRow({ connected: true });
    const { rerender } = renderRow(row);

    expect(screen.queryByTestId('machine-backups-section')).toBeNull();

    rerender(<MachineList rows={[row]} expandedMachineId="machine-1" onToggle={() => {}} />);

    const section = screen.getByTestId('machine-backups-section');
    expect(within(section).getByTestId('machine-backups')).toBeInTheDocument();
    expect(mocks.backupInventoryRequest).not.toHaveBeenCalled();
    expect(section.contains(screen.getByTestId('backups-check'))).toBe(true);

    const user = userEvent.setup();
    await user.click(screen.getByTestId('backups-check'));

    await waitFor(() =>
      expect(mocks.backupInventoryRequest).toHaveBeenCalledWith({ machineId: 'machine-1' })
    );
    expect(mocks.backupInventoryRequest).toHaveBeenCalledTimes(1);
  });

  it('starts the listing phase from the Export chatrooms action, even while offline', async () => {
    let releaseList: (rows: unknown[]) => void = () => {};
    const listGate = new Promise<unknown[]>((resolve) => {
      releaseList = resolve;
    });
    mocks.query.mockReturnValueOnce(listGate);

    renderRow(makeRow({ connected: false, usage: USAGE }));
    const user = await openActions();
    await user.click(screen.getByTestId('machine-action-export'));

    expect(await screen.findByText('Finding chatrooms on this machine…')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();

    releaseList([]);

    expect(await screen.findByText(MACHINE_EMPTY_COPY)).toBeInTheDocument();
  });

  describe('import action', () => {
    beforeEach(() => {
      window.localStorage.clear();
    });

    it('opens the dialog locked to an online machine', async () => {
      renderRow(makeRow({ connected: true }));
      await openImportDialog();

      expect(screen.getByTestId('import-target')).toBeInTheDocument();
      expect(screen.getByTestId('import-target-name').textContent).toBe('studio-mac');
      expect(screen.getByTestId('import-target-status').textContent).toBe('Online');
      expect(screen.queryByTestId('import-file-input')).toBeInTheDocument();
    });

    it('opens offline and keeps the notice on the File and Select steps', async () => {
      renderRow(makeRow({ connected: false, lastSeenAt: null }));
      await openImportDialog();

      expect(screen.getByTestId('import-target-status').textContent).toBe('Offline');
      expect(
        screen.getByText(
          'studio-mac is offline. The chatrooms are created now; agents cannot start until its daemon runs.'
        )
      ).toBeInTheDocument();

      await uploadExport(await exportFile());

      expect(await screen.findByTestId('import-entry-list')).toBeInTheDocument();
      expect(
        screen.getByText(
          'studio-mac is offline. The chatrooms are created now; agents cannot start until its daemon runs.'
        )
      ).toBeInTheDocument();
    });

    it('opens while connectivity is checking and still allows import', async () => {
      renderRow(makeRow({ connected: undefined }));
      const user = await openActions();
      const item = screen.getByTestId('machine-action-import');
      expect(item).toBeEnabled();

      await user.click(item);

      expect(await screen.findByTestId('import-dialog')).toBeInTheDocument();
      expect(screen.getByTestId('import-target-status').textContent).toBe('Checking…');
    });

    it('returns focus to the actions trigger on close', async () => {
      renderRow(makeRow({ connected: true }));
      await openImportDialog();

      fireEvent.click(screen.getAllByRole('button', { name: 'Close' })[0]!);

      await waitFor(() => expect(screen.getByTestId('machine-actions-trigger')).toHaveFocus());
    });

    it('opens from a collapsed card and survives expanding and collapsing the body', async () => {
      const row = makeRow({ connected: true });
      const { rerender } = renderExpanded(row, null);

      await openImportDialog();

      rerender(<MachineList rows={[row]} expandedMachineId="machine-1" onToggle={() => {}} />);
      expect(screen.getByTestId('import-dialog')).toBeInTheDocument();

      rerender(<MachineList rows={[row]} expandedMachineId={null} onToggle={() => {}} />);
      expect(screen.getByTestId('import-dialog')).toBeInTheDocument();
    });

    it('renders no machine radio in the card dialog', async () => {
      renderRow(makeRow({ connected: true }));
      await openImportDialog();

      expect(screen.queryAllByTestId('import-machine')).toHaveLength(0);
      expect(screen.queryByRole('radio')).toBeNull();
    });
  });
});
