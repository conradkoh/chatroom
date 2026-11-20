import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { FunctionReference } from 'convex/server';
import { getFunctionName } from 'convex/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MachineRepositories } from './MachineRepositories';
import type { LedgerEntryView } from '../hooks/useRepositoryLedger';

interface LedgerRow {
  _id: string;
  status: 'pending' | 'completed' | 'failed';
  rescan: boolean;
  expiresAt: number;
  errorMessage?: string;
  repositoryCount?: number;
  invalidPathCount?: number;
  truncated?: boolean;
  roots?: { path: string; status: 'ok' | 'missing' | 'unreadable'; repositoryCount: number }[];
  ledgerGeneratedAt?: number;
  completedAt?: number;
  updatedAt: number;
}

interface Page {
  results: LedgerEntryView[];
  status: 'LoadingFirstPage' | 'CanLoadMore' | 'LoadingMore' | 'Exhausted';
  loadMore: ReturnType<typeof vi.fn>;
}

const FIVE_MINUTES_MS = 5 * 60_000;
const TEN_MINUTES_MS = 10 * 60_000;

const mocks = vi.hoisted(() => ({
  rows: new Map<string, LedgerRow | null>(),
  page: undefined as Page | undefined,
  request: vi.fn(),
  discard: vi.fn(),
  createMany: vi.fn(),
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}));

vi.mock('convex-helpers/react/sessions', () => ({
  useSessionQuery: (query: unknown, args?: { requestId?: string } | 'skip') => {
    const name = getFunctionName(query as FunctionReference<'query'>);
    if (name !== 'repositoryLedger:get') throw new Error(`Unexpected query: ${name}`);
    if (args === 'skip') return undefined;
    const requestId = (args as { requestId: string }).requestId;
    return mocks.rows.has(requestId) ? mocks.rows.get(requestId) : undefined;
  },
  useSessionMutation: (mutation: unknown) => {
    const name = getFunctionName(mutation as FunctionReference<'mutation'>);
    if (name === 'repositoryLedger:request') return mocks.request;
    if (name === 'repositoryLedger:discard') return mocks.discard;
    if (name === 'chatrooms:createManyWithWorkspace') return mocks.createMany;
    throw new Error(`Unexpected mutation: ${name}`);
  },
  useSessionPaginatedQuery: (query: unknown) => {
    const name = getFunctionName(query as FunctionReference<'query'>);
    if (name !== 'repositoryLedger:listEntries') {
      throw new Error(`Unexpected paginated query: ${name}`);
    }
    return mocks.page;
  },
}));

vi.mock('sonner', () => ({ toast: mocks.toast }));

// jsdom has no layout: render every item so rows are queryable.
vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: ({ count }: { count: number }) => ({
    getTotalSize: () => count * 72,
    getVirtualItems: () =>
      Array.from({ length: count }, (_, index) => ({
        index,
        key: index,
        start: index * 72,
        size: 72,
      })),
    scrollToIndex: vi.fn(),
    scrollToOffset: vi.fn(),
  }),
}));

function entry(path: string, overrides: Partial<LedgerEntryView> = {}): LedgerEntryView {
  return {
    path,
    name: path.split('/').pop() ?? path,
    root: '/Users/me/projects',
    branch: 'main',
    discoveredAt: Date.now(),
    hasChatroom: false,
    ...overrides,
  };
}

function pendingRow(overrides: Partial<LedgerRow> = {}): LedgerRow {
  return {
    _id: 'req-1',
    status: 'pending',
    rescan: false,
    expiresAt: Date.now() + FIVE_MINUTES_MS,
    updatedAt: Date.now(),
    ...overrides,
  };
}

function completedRow(overrides: Partial<LedgerRow> = {}): LedgerRow {
  return {
    _id: 'req-1',
    status: 'completed',
    rescan: false,
    expiresAt: Date.now() + TEN_MINUTES_MS,
    repositoryCount: 0,
    invalidPathCount: 0,
    truncated: false,
    roots: [],
    ledgerGeneratedAt: Date.now(),
    completedAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

function makePage(overrides: Partial<Page> = {}): Page {
  return { results: [], status: 'Exhausted', loadMore: vi.fn(), ...overrides };
}

function renderRepositories(
  overrides: Partial<{
    machineId: string;
    displayName: string;
    connected: boolean | undefined;
    hasRoots: boolean | undefined;
  }> = {}
) {
  return render(
    <MachineRepositories
      machineId="m-1"
      displayName="Studio Mac"
      connected={true}
      hasRoots={true}
      {...overrides}
    />
  );
}

async function clickLoad(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByTestId('ledger-load'));
}

describe('MachineRepositories', () => {
  beforeEach(() => {
    mocks.rows = new Map();
    mocks.page = makePage();
    mocks.request.mockReset();
    mocks.request.mockResolvedValue({ requestId: 'req-1', reused: false });
    mocks.discard.mockReset();
    mocks.discard.mockResolvedValue({ ok: true });
    mocks.createMany.mockReset();
    mocks.toast.mockReset();
    mocks.toast.success.mockReset();
    mocks.toast.error.mockReset();
  });

  it('loads repositories from the idle state', async () => {
    const user = userEvent.setup();
    mocks.rows.set('req-1', pendingRow());
    renderRepositories();

    const load = screen.getByTestId('ledger-load');
    expect(load).toBeEnabled();
    await clickLoad(user);

    expect(mocks.request).toHaveBeenCalledWith({ machineId: 'm-1', rescan: false });
  });

  it('blocks loading while the machine is offline', () => {
    renderRepositories({ connected: false });

    expect(screen.getByTestId('ledger-idle').textContent).toContain(
      'Machine is offline. Start the daemon to load repositories.'
    );
    expect(screen.getByTestId('ledger-load')).toBeDisabled();
  });

  it('blocks loading while there are no project roots', () => {
    renderRepositories({ hasRoots: false });

    expect(screen.getByTestId('ledger-idle').textContent).toContain(
      'Add a project root above, then load repositories.'
    );
    expect(screen.getByTestId('ledger-load')).toBeDisabled();
  });

  it('explains an expired snapshot', async () => {
    const user = userEvent.setup();
    mocks.rows.set(
      'req-1',
      completedRow({ expiresAt: Date.now() - 1_000, ledgerGeneratedAt: Date.now() - 11 * 60_000 })
    );
    renderRepositories();

    await clickLoad(user);

    expect((await screen.findByTestId('ledger-idle')).textContent).toContain(
      'That snapshot expired. Load it again.'
    );
  });

  it('shows the asking state and cancels with a discard', async () => {
    const user = userEvent.setup();
    mocks.rows.set('req-1', pendingRow());
    renderRepositories();

    await clickLoad(user);

    expect((await screen.findByTestId('ledger-asking')).textContent).toContain('Asking daemon…');
    expect(screen.getByText('Waiting for Studio Mac to scan its project roots.')).toBeDefined();

    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(mocks.discard).toHaveBeenCalledWith({ requestId: 'req-1' });
  });

  it('shows the timed-out copy and retries the request', async () => {
    const user = userEvent.setup();
    mocks.rows.set('req-1', pendingRow({ expiresAt: Date.now() - 1_000 }));
    renderRepositories();

    await clickLoad(user);

    expect((await screen.findByTestId('ledger-timed-out')).textContent).toContain(
      'The daemon did not respond. It may need updating, or it went offline.'
    );
    await user.click(screen.getByRole('button', { name: 'Try again' }));

    expect(mocks.request).toHaveBeenLastCalledWith({ machineId: 'm-1', rescan: false });
  });

  it('shows the daemon failure message', async () => {
    const user = userEvent.setup();
    mocks.rows.set('req-1', pendingRow({ status: 'failed', errorMessage: 'Disk unreadable' }));
    renderRepositories();

    await clickLoad(user);

    expect((await screen.findByTestId('ledger-failed')).textContent).toContain(
      'Could not read repositories: Disk unreadable'
    );
  });

  it('renders a ready snapshot with its rows and summary', async () => {
    const user = userEvent.setup();
    const entries = [
      entry('/Users/me/projects/a'),
      entry('/Users/me/projects/b'),
      entry('/Users/me/projects/c'),
    ];
    mocks.rows.set('req-1', completedRow({ repositoryCount: 3 }));
    mocks.page = makePage({ results: entries, status: 'Exhausted' });
    renderRepositories();

    await clickLoad(user);

    const summary = await screen.findByTestId('ledger-summary');
    expect(summary.textContent).toMatch(/^Snapshot from .+ · 3 repositories · not kept in sync$/);
    expect(summary.textContent).not.toMatch(/live|synced|auto/i);
    expect(screen.getAllByTestId('repository-row')).toHaveLength(3);
  });

  it('renders the empty snapshot copy', async () => {
    const user = userEvent.setup();
    mocks.rows.set('req-1', completedRow({ repositoryCount: 0 }));
    mocks.page = makePage({ results: [], status: 'Exhausted' });
    renderRepositories();

    await clickLoad(user);

    expect((await screen.findByTestId('ledger-empty')).textContent).toBe(
      'No git repositories found under your project roots.'
    );
  });

  it('keeps the rows while a rescan is in flight', async () => {
    const user = userEvent.setup();
    const entries = [
      entry('/Users/me/projects/a'),
      entry('/Users/me/projects/b'),
      entry('/Users/me/projects/c'),
    ];
    mocks.rows.set('req-1', completedRow({ repositoryCount: 3 }));
    mocks.page = makePage({ results: entries, status: 'Exhausted' });
    renderRepositories();

    await clickLoad(user);
    await screen.findByTestId('ledger-ready');

    mocks.request.mockResolvedValue({ requestId: 'req-2', reused: false });
    mocks.rows.set('req-2', pendingRow({ _id: 'req-2', rescan: true }));
    await user.click(screen.getByTestId('ledger-rescan'));

    const rescan = screen.getByTestId('ledger-rescan');
    expect(rescan).toBeDisabled();
    expect(rescan.textContent).toContain('Asking daemon…');
    expect(screen.getAllByTestId('repository-row')).toHaveLength(3);
  });

  it('creates one chatroom from a row through the bulk mutation', async () => {
    const user = userEvent.setup();
    const target = entry('/Users/me/projects/a');
    mocks.rows.set('req-1', completedRow({ repositoryCount: 1 }));
    mocks.page = makePage({ results: [target], status: 'Exhausted' });
    mocks.createMany.mockResolvedValue({
      results: [
        {
          workingDir: target.path,
          outcome: 'created',
          chatroomId: 'room-1',
          workspaceId: 'workspace-1',
        },
      ],
      created: 1,
      skipped: 0,
      failed: 0,
    });
    renderRepositories();

    await clickLoad(user);
    const row = await screen.findByTestId('repository-row');
    await user.click(within(row).getByRole('button', { name: 'Create chatroom' }));

    expect(mocks.createMany).toHaveBeenCalledWith({
      machineId: 'm-1',
      workingDirs: [target.path],
    });
    await waitFor(() => expect(mocks.toast.success).toHaveBeenCalledWith('Chatroom created'));
  });

  it('shows page progress while the snapshot rows load', async () => {
    const user = userEvent.setup();
    mocks.rows.set('req-1', completedRow({ repositoryCount: 3 }));
    mocks.page = makePage({
      results: [entry('/Users/me/projects/a'), entry('/Users/me/projects/b')],
      status: 'CanLoadMore',
    });
    renderRepositories();

    await clickLoad(user);

    expect((await screen.findByTestId('ledger-loading-pages')).textContent).toContain(
      'Loading repositories… 2 of 3'
    );
  });

  it('disables create on every row when the machine goes offline', async () => {
    const user = userEvent.setup();
    mocks.rows.set('req-1', completedRow({ repositoryCount: 1 }));
    mocks.page = makePage({ results: [entry('/Users/me/projects/a')], status: 'Exhausted' });
    const { rerender } = renderRepositories();

    await clickLoad(user);
    await screen.findByTestId('ledger-ready');

    rerender(
      <MachineRepositories
        machineId="m-1"
        displayName="Studio Mac"
        connected={false}
        hasRoots={true}
      />
    );

    const row = screen.getByTestId('repository-row');
    expect(within(row).getByRole('button', { name: 'Create chatroom' })).toBeDisabled();
  });
});
