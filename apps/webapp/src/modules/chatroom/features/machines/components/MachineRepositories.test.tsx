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
    currentRootPaths: readonly string[] | undefined;
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

const FILTER_ENTRIES: LedgerEntryView[] = [
  entry('/Users/me/projects/api-service', { name: 'Api-Service' }),
  entry('/Users/me/work/web', {
    name: 'web',
    root: '/Users/me/work',
    branch: 'feat/Login',
    hasChatroom: true,
  }),
  entry('/Users/me/projects/docs', { name: 'docs' }),
];

describe('MachineRepositories', () => {
  beforeEach(() => {
    mocks.rows = new Map();
    mocks.page = makePage();
    mocks.request.mockReset();
    mocks.request.mockResolvedValue({ requestId: 'req-1', reused: false });
    mocks.discard.mockReset();
    mocks.discard.mockResolvedValue({ ok: true });
    mocks.createMany.mockReset();
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
    await waitFor(() =>
      expect(within(row).getByRole('button', { name: 'Create chatroom' })).toBeEnabled()
    );
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows an already-has-chatroom skip inline in its row', async () => {
    const user = userEvent.setup();
    const target = entry('/Users/me/projects/a');
    mocks.rows.set('req-1', completedRow({ repositoryCount: 1 }));
    mocks.page = makePage({ results: [target], status: 'Exhausted' });
    mocks.createMany.mockResolvedValue({
      results: [
        {
          workingDir: target.path,
          outcome: 'skipped',
          reason: 'already_has_chatroom',
          chatroomId: 'room-1',
        },
      ],
      created: 0,
      skipped: 1,
      failed: 0,
    });
    renderRepositories();

    await clickLoad(user);
    const row = await screen.findByTestId('repository-row');
    await user.click(within(row).getByRole('button', { name: 'Create chatroom' }));

    expect(await within(row).findByRole('status')).toHaveTextContent(
      'This repository already has a chatroom.'
    );
    expect(within(row).queryByRole('alert')).toBeNull();
  });

  it('shows a failed outcome message inline in the affected row only', async () => {
    const user = userEvent.setup();
    const bad = entry('/Users/me/projects/a');
    const other = entry('/Users/me/projects/b');
    mocks.rows.set('req-1', completedRow({ repositoryCount: 2 }));
    mocks.page = makePage({ results: [bad, other], status: 'Exhausted' });
    mocks.createMany.mockResolvedValue({
      results: [
        {
          workingDir: bad.path,
          outcome: 'failed',
          code: 'INVALID_WORKING_DIR',
          message: "That path isn't valid.",
        },
      ],
      created: 0,
      skipped: 0,
      failed: 1,
    });
    renderRepositories();

    await clickLoad(user);
    const [badRow, otherRow] = await screen.findAllByTestId('repository-row');
    await user.click(within(badRow).getByRole('button', { name: 'Create chatroom' }));

    expect(await within(badRow).findByRole('alert')).toHaveTextContent("That path isn't valid.");
    expect(within(otherRow).queryByRole('alert')).toBeNull();
    expect(screen.getAllByRole('alert')).toHaveLength(1);
  });

  it('shows the fallback copy when a failed outcome has no message', async () => {
    const user = userEvent.setup();
    const target = entry('/Users/me/projects/a');
    mocks.rows.set('req-1', completedRow({ repositoryCount: 1 }));
    mocks.page = makePage({ results: [target], status: 'Exhausted' });
    mocks.createMany.mockResolvedValue({
      results: [
        { workingDir: target.path, outcome: 'failed', code: 'INVALID_WORKING_DIR', message: '' },
      ],
      created: 0,
      skipped: 0,
      failed: 1,
    });
    renderRepositories();

    await clickLoad(user);
    const row = await screen.findByTestId('repository-row');
    await user.click(within(row).getByRole('button', { name: 'Create chatroom' }));

    expect(await within(row).findByRole('alert')).toHaveTextContent(
      'Could not create the chatroom. Try again.'
    );
  });

  it('shows the fallback copy inline when the create call throws', async () => {
    const user = userEvent.setup();
    const target = entry('/Users/me/projects/a');
    mocks.rows.set('req-1', completedRow({ repositoryCount: 1 }));
    mocks.page = makePage({ results: [target], status: 'Exhausted' });
    mocks.createMany.mockRejectedValue(
      new Error('[CONVEX M(chatrooms:createManyWithWorkspace)] boom')
    );
    renderRepositories();

    await clickLoad(user);
    const row = await screen.findByTestId('repository-row');
    await user.click(within(row).getByRole('button', { name: 'Create chatroom' }));

    expect(await within(row).findByRole('alert')).toHaveTextContent(
      'Could not create the chatroom. Try again.'
    );
  });

  it('keeps an inline failure until the next create from that row', async () => {
    const user = userEvent.setup();
    const bad = entry('/Users/me/projects/a');
    const other = entry('/Users/me/projects/b');
    mocks.rows.set('req-1', completedRow({ repositoryCount: 2 }));
    mocks.page = makePage({ results: [bad, other], status: 'Exhausted' });
    const created = (workingDir: string) => ({
      results: [
        { workingDir, outcome: 'created', chatroomId: 'room-1', workspaceId: 'workspace-1' },
      ],
      created: 1,
      skipped: 0,
      failed: 0,
    });
    mocks.createMany
      .mockResolvedValueOnce({
        results: [
          {
            workingDir: bad.path,
            outcome: 'failed',
            code: 'INVALID_WORKING_DIR',
            message: 'Nope.',
          },
        ],
        created: 0,
        skipped: 0,
        failed: 1,
      })
      .mockResolvedValueOnce(created(other.path))
      .mockResolvedValueOnce(created(bad.path));
    renderRepositories();

    await clickLoad(user);
    const [badRow, otherRow] = await screen.findAllByTestId('repository-row');
    await user.click(within(badRow).getByRole('button', { name: 'Create chatroom' }));
    expect(await within(badRow).findByRole('alert')).toHaveTextContent('Nope.');

    await user.click(within(otherRow).getByRole('button', { name: 'Create chatroom' }));
    await waitFor(() => expect(mocks.createMany).toHaveBeenCalledTimes(2));
    expect(within(badRow).getByRole('alert')).toHaveTextContent('Nope.');

    await user.click(within(badRow).getByRole('button', { name: 'Create chatroom' }));
    await waitFor(() => expect(mocks.createMany).toHaveBeenCalledTimes(3));
    await waitFor(() => expect(within(badRow).queryByRole('alert')).toBeNull());
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

  it('narrows the rows by name, case-insensitively', async () => {
    const user = userEvent.setup();
    mocks.rows.set('req-1', completedRow({ repositoryCount: 3 }));
    mocks.page = makePage({ results: FILTER_ENTRIES, status: 'Exhausted' });
    renderRepositories();

    await clickLoad(user);
    await screen.findByTestId('ledger-ready');
    await user.type(screen.getByTestId('ledger-filter'), 'API');

    await waitFor(() => expect(screen.getAllByTestId('repository-row')).toHaveLength(1));
    expect(screen.getByTestId('repository-row').textContent).toContain('Api-Service');
  });

  it('narrows the rows by branch, case-insensitively', async () => {
    const user = userEvent.setup();
    mocks.rows.set('req-1', completedRow({ repositoryCount: 3 }));
    mocks.page = makePage({ results: FILTER_ENTRIES, status: 'Exhausted' });
    renderRepositories();

    await clickLoad(user);
    await screen.findByTestId('ledger-ready');
    await user.type(screen.getByTestId('ledger-filter'), 'login');

    await waitFor(() => expect(screen.getAllByTestId('repository-row')).toHaveLength(1));
    expect(screen.getByTestId('repository-row').textContent).toContain('web');
  });

  it('shows the no-match copy and restores the rows when the filter is cleared', async () => {
    const user = userEvent.setup();
    mocks.rows.set('req-1', completedRow({ repositoryCount: 3 }));
    mocks.page = makePage({ results: FILTER_ENTRIES, status: 'Exhausted' });
    renderRepositories();

    await clickLoad(user);
    await screen.findByTestId('ledger-ready');
    await user.type(screen.getByTestId('ledger-filter'), 'zzz');

    const noMatch = await screen.findByTestId('ledger-no-match');
    expect(within(noMatch).getByText('No repositories match “zzz”.')).toBeDefined();
    await user.click(within(noMatch).getByRole('button', { name: 'Clear filter' }));

    await waitFor(() => expect(screen.getAllByTestId('repository-row')).toHaveLength(3));
    expect((screen.getByTestId('ledger-filter') as HTMLInputElement).value).toBe('');
  });

  it('clears the filter on Escape', async () => {
    const user = userEvent.setup();
    mocks.rows.set('req-1', completedRow({ repositoryCount: 3 }));
    mocks.page = makePage({ results: FILTER_ENTRIES, status: 'Exhausted' });
    renderRepositories();

    await clickLoad(user);
    await screen.findByTestId('ledger-ready');
    await user.type(screen.getByTestId('ledger-filter'), 'zzz');
    await screen.findByTestId('ledger-no-match');
    await user.keyboard('{Escape}');

    await waitFor(() => expect(screen.getAllByTestId('repository-row')).toHaveLength(3));
  });

  it('shows the truncated banner', async () => {
    const user = userEvent.setup();
    mocks.rows.set('req-1', completedRow({ truncated: true, repositoryCount: 3 }));
    mocks.page = makePage({ results: [entry('/Users/me/projects/a')], status: 'Exhausted' });
    renderRepositories();

    await clickLoad(user);

    expect((await screen.findByTestId('ledger-banner-truncated')).textContent).toBe(
      'Showing the first 1,000 repositories. Narrow your project roots to see the rest.'
    );
  });

  it('shows the omitted banner with the stored plural count', async () => {
    const user = userEvent.setup();
    mocks.rows.set('req-1', completedRow({ repositoryCount: 1, invalidPathCount: 3 }));
    mocks.page = makePage({ results: [entry('/Users/me/projects/a')], status: 'Exhausted' });
    renderRepositories();

    await clickLoad(user);

    expect((await screen.findByTestId('ledger-banner-omitted')).textContent).toBe(
      '3 entries are left out of this snapshot: invalid, over-long, or duplicate paths.'
    );
  });

  it('shows the omitted banner with the stored singular count', async () => {
    const user = userEvent.setup();
    mocks.rows.set('req-1', completedRow({ repositoryCount: 1, invalidPathCount: 1 }));
    mocks.page = makePage({ results: [entry('/Users/me/projects/a')], status: 'Exhausted' });
    renderRepositories();

    await clickLoad(user);

    expect((await screen.findByTestId('ledger-banner-omitted')).textContent).toBe(
      '1 entry is left out of this snapshot: invalid, over-long, or duplicate paths.'
    );
  });

  it('shows the missing-root banner', async () => {
    const user = userEvent.setup();
    mocks.rows.set(
      'req-1',
      completedRow({
        repositoryCount: 0,
        roots: [{ path: '/Users/me/old-root', status: 'missing', repositoryCount: 0 }],
      })
    );
    mocks.page = makePage({ results: [], status: 'Exhausted' });
    renderRepositories();

    await clickLoad(user);

    expect((await screen.findByTestId('ledger-banner-roots-missing')).textContent).toBe(
      '1 root was not found on this machine: /Users/me/old-root'
    );
  });

  it('shows the roots-changed banner only when the current roots differ', async () => {
    const user = userEvent.setup();
    mocks.rows.set(
      'req-1',
      completedRow({
        repositoryCount: 1,
        roots: [{ path: '/Users/me/projects', status: 'ok', repositoryCount: 1 }],
      })
    );
    mocks.page = makePage({ results: [entry('/Users/me/projects/a')], status: 'Exhausted' });
    const { rerender } = renderRepositories({
      currentRootPaths: ['/Users/me/projects', '/Users/me/new'],
    });

    await clickLoad(user);
    expect(await screen.findByTestId('ledger-banner-roots-changed')).toBeDefined();

    rerender(
      <MachineRepositories
        machineId="m-1"
        displayName="Studio Mac"
        connected={true}
        hasRoots={true}
        currentRootPaths={['/Users/me/projects']}
      />
    );
    expect(screen.queryByTestId('ledger-banner-roots-changed')).toBeNull();

    rerender(
      <MachineRepositories
        machineId="m-1"
        displayName="Studio Mac"
        connected={true}
        hasRoots={true}
        currentRootPaths={undefined}
      />
    );
    expect(screen.queryByTestId('ledger-banner-roots-changed')).toBeNull();
  });

  it('shows the stale banner when the machine goes offline', async () => {
    const user = userEvent.setup();
    mocks.rows.set('req-1', completedRow({ repositoryCount: 1 }));
    mocks.page = makePage({ results: [entry('/Users/me/projects/a')], status: 'Exhausted' });
    const { rerender } = renderRepositories();

    await clickLoad(user);
    await screen.findByTestId('ledger-ready');
    expect(screen.queryByTestId('ledger-banner-stale')).toBeNull();

    rerender(
      <MachineRepositories
        machineId="m-1"
        displayName="Studio Mac"
        connected={false}
        hasRoots={true}
      />
    );

    expect(screen.getByTestId('ledger-banner-stale').textContent).toBe(
      'Machine is offline. This snapshot may be out of date.'
    );
  });

  it('shows no banners for a clean snapshot', async () => {
    const user = userEvent.setup();
    mocks.rows.set(
      'req-1',
      completedRow({
        repositoryCount: 1,
        truncated: false,
        invalidPathCount: 0,
        roots: [{ path: '/Users/me/projects', status: 'ok', repositoryCount: 1 }],
      })
    );
    mocks.page = makePage({ results: [entry('/Users/me/projects/a')], status: 'Exhausted' });
    renderRepositories({ currentRootPaths: ['/Users/me/projects'] });

    await clickLoad(user);
    await screen.findByTestId('ledger-ready');

    expect(screen.queryAllByTestId(/^ledger-banner-/)).toHaveLength(0);
  });

  it('counts the visible no-chatroom rows for the bulk trigger', async () => {
    const user = userEvent.setup();
    const entries = [
      entry('/Users/me/projects/api'),
      entry('/Users/me/projects/app'),
      entry('/Users/me/projects/docs'),
      entry('/Users/me/work/mobile', { root: '/Users/me/work', hasChatroom: true }),
    ];
    mocks.rows.set('req-1', completedRow({ repositoryCount: 4 }));
    mocks.page = makePage({ results: entries, status: 'Exhausted' });
    renderRepositories();

    await clickLoad(user);

    expect((await screen.findByTestId('bulk-create-open')).textContent).toBe(
      'Create chatrooms for 3 repositories'
    );

    await user.type(screen.getByTestId('ledger-filter'), 'ap');

    await waitFor(() =>
      expect(screen.getByTestId('bulk-create-open').textContent).toBe(
        'Create chatrooms for 2 repositories'
      )
    );
  });

  it('disables the bulk trigger with the winning reason', async () => {
    const user = userEvent.setup();
    const entries = [entry('/Users/me/projects/a')];
    mocks.rows.set('req-1', completedRow({ repositoryCount: 1 }));
    mocks.page = makePage({ results: entries, status: 'Exhausted' });
    const { rerender } = renderRepositories();

    await clickLoad(user);
    await screen.findByTestId('ledger-ready');
    expect(screen.getByTestId('bulk-create-open')).toBeEnabled();

    rerender(
      <MachineRepositories
        machineId="m-1"
        displayName="Studio Mac"
        connected={false}
        hasRoots={true}
      />
    );
    const offline = screen.getByTestId('bulk-create-open');
    expect(offline.textContent).toBe('Machine is offline');
    expect(offline).toBeDisabled();

    rerender(
      <MachineRepositories
        machineId="m-1"
        displayName="Studio Mac"
        connected={undefined}
        hasRoots={true}
      />
    );
    expect(screen.getByTestId('bulk-create-open').textContent).toBe('Checking machine…');

    mocks.page = makePage({ results: entries, status: 'CanLoadMore' });
    rerender(
      <MachineRepositories
        machineId="m-1"
        displayName="Studio Mac"
        connected={true}
        hasRoots={true}
      />
    );
    const loading = screen.getByTestId('bulk-create-open');
    expect(loading.textContent).toBe('Loading repositories…');
    expect(loading).toBeDisabled();
  });

  it('shows the done line instead of the bulk trigger when every row has a chatroom', async () => {
    const user = userEvent.setup();
    mocks.rows.set('req-1', completedRow({ repositoryCount: 1 }));
    mocks.page = makePage({
      results: [entry('/Users/me/projects/a', { hasChatroom: true })],
      status: 'Exhausted',
    });
    renderRepositories();

    await clickLoad(user);

    expect((await screen.findByTestId('bulk-create-done')).textContent).toBe(
      'Every repository shown has a chatroom.'
    );
    expect(screen.queryByTestId('bulk-create-open')).toBeNull();
  });

  it('hides the bulk area when the filter matches nothing', async () => {
    const user = userEvent.setup();
    mocks.rows.set('req-1', completedRow({ repositoryCount: 1 }));
    mocks.page = makePage({ results: [entry('/Users/me/projects/a')], status: 'Exhausted' });
    renderRepositories();

    await clickLoad(user);
    await screen.findByTestId('ledger-ready');
    await user.type(screen.getByTestId('ledger-filter'), 'zzz');

    await screen.findByTestId('ledger-no-match');
    expect(screen.queryByTestId('bulk-create-open')).toBeNull();
    expect(screen.queryByTestId('bulk-create-done')).toBeNull();
  });

  it('opens the bulk dialog with the first 50 of 120 repositories to create', async () => {
    const user = userEvent.setup();
    const entries = Array.from({ length: 120 }, (_, index) =>
      entry(`/Users/me/projects/repo-${String(index).padStart(3, '0')}`)
    );
    mocks.rows.set('req-1', completedRow({ repositoryCount: 120 }));
    mocks.page = makePage({ results: entries, status: 'Exhausted' });
    renderRepositories();

    await clickLoad(user);

    const open = await screen.findByTestId('bulk-create-open');
    expect(open.textContent).toBe('Create chatrooms for 120 repositories');
    await user.click(open);

    expect(await screen.findByTestId('bulk-create-dialog')).toBeDefined();
    expect(screen.getAllByTestId('bulk-create-path')).toHaveLength(50);
    expect(screen.getByTestId('bulk-create-confirm').textContent).toBe('Create 50 chatrooms');
  });

  it('moves the only Rescan into the empty snapshot and hides the filter', async () => {
    const user = userEvent.setup();
    mocks.rows.set('req-1', completedRow({ repositoryCount: 0 }));
    mocks.page = makePage({ results: [], status: 'Exhausted' });
    renderRepositories();

    await clickLoad(user);
    const ready = await screen.findByTestId('ledger-ready');

    expect(within(ready).getByTestId('ledger-rescan')).toBeDefined();
    expect(within(ready).getAllByTestId('ledger-rescan')).toHaveLength(1);
    expect(screen.queryByTestId('ledger-filter')).toBeNull();
  });
});
