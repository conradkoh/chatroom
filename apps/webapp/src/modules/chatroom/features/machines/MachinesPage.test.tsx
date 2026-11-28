import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { FunctionReference } from 'convex/server';
import { getFunctionName } from 'convex/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MachinesPage } from './MachinesPage';
import type { UserMachine } from '../../types/machine';
import { writeInflightImport } from '../transfer/lib/inflightImport';

import { getDaemonStartCommand } from '@/lib/environment';

interface UsageRow {
  machineId: string;
  activeWorkspaceCount: number;
  activeChatroomCount: number;
  capped: boolean;
}

const mocks = vi.hoisted(() => ({
  registry: undefined as { machines: UserMachine[] } | undefined,
  connectivity: undefined as { machines: { machineId: string; connected: boolean }[] } | undefined,
  usage: undefined as { machines: UsageRow[] } | undefined,
  lastSeen: undefined as
    { machines: { machineId: string; lastSeenAt: number | null }[] } | undefined,
  capabilities: undefined as
    | Record<string, { availableHarnesses: string[]; harnessVersions: Record<string, never> }>
    | undefined,
  /** machine ids the roots section subscribed for; empty while every card is collapsed. */
  rootsMachineIds: [] as string[],
  shouldThrow: false,
  setMachineAlias: vi.fn(),
  noopMutation: vi.fn(),
}));

vi.mock('convex-helpers/react/sessions', () => ({
  useSessionId: () => ['session-1'],
  useSessionQuery: (query: unknown, args?: { machineId?: string } | 'skip') => {
    if (mocks.shouldThrow) throw new Error('[CONVEX Q(machines:getUserMachines)] boom');
    const name = getFunctionName(query as FunctionReference<'query'>);
    switch (name) {
      case 'machines:getUserMachines':
        return mocks.registry;
      case 'machines:listMachineConnectivity':
        return mocks.connectivity;
      case 'machines:getMachineUsage':
        return mocks.usage;
      case 'machines:listMachineLastSeen':
        return mocks.lastSeen;
      case 'machines:getMachineCapabilities':
        return mocks.capabilities?.[(args as { machineId?: string })?.machineId ?? ''];
      case 'machineProjectRoots:list': {
        // Two hook calls share one Convex subscription, so record each machine once.
        const machineId = (args as { machineId: string }).machineId;
        if (!mocks.rootsMachineIds.includes(machineId)) mocks.rootsMachineIds.push(machineId);
        return { roots: [] };
      }
      case 'folderBrowse:get':
      case 'folderBrowse:getListing':
        return undefined;
      case 'repositoryLedger:get':
        return undefined;
      case 'machineBackups:getRequest':
        return undefined;
      case 'machineBackups:getActiveDownload':
        return null;
      default:
        throw new Error(`Unexpected query: ${name}`);
    }
  },
  useSessionMutation: (mutation: unknown) => {
    const name = getFunctionName(mutation as FunctionReference<'mutation'>);
    return name === 'machines:setMachineAlias' ? mocks.setMachineAlias : mocks.noopMutation;
  },
  useSessionPaginatedQuery: () => undefined,
}));

vi.mock('next/navigation', () => ({
  usePathname: () => '/app/machines',
}));

vi.mock('convex/react', () => ({
  useConvex: () => ({
    query: async (ref: { name?: string }) => {
      if (ref.name === 'listForMachine') return [];
      throw new Error(`Unexpected convex.query: ${ref.name}`);
    },
  }),
}));

vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children: React.ReactNode;
  } & Record<string, unknown>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

function machine(overrides: Partial<UserMachine> & { machineId: string }): UserMachine {
  return { hostname: 'host', os: 'darwin', registeredAt: 0, ...overrides };
}

const ALPHA = machine({ machineId: 'm-alpha', alias: 'Alpha', registeredAt: 1 });
const BRAVO = machine({ machineId: 'm-bravo', hostname: 'Bravo', registeredAt: 2 });
const CHARLIE = machine({ machineId: 'm-charlie', alias: 'charlie', registeredAt: 3 });

function cardIds(): (string | null)[] {
  return screen.getAllByTestId('machine-card').map((card) => card.getAttribute('data-machine-id'));
}

describe('MachinesPage', () => {
  let consoleError: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    mocks.registry = undefined;
    mocks.connectivity = undefined;
    mocks.usage = undefined;
    mocks.lastSeen = undefined;
    mocks.capabilities = undefined;
    mocks.shouldThrow = false;
    mocks.rootsMachineIds = [];
    mocks.setMachineAlias.mockReset();
    mocks.setMachineAlias.mockResolvedValue({ success: true });
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleError.mockRestore();
  });

  it('renders loading skeletons while the registry loads', () => {
    render(<MachinesPage />);

    const loading = screen.getByTestId('machines-loading');
    expect(within(loading).getAllByRole('listitem')).toHaveLength(3);
  });

  it('renders the empty state with the daemon start command', () => {
    mocks.registry = { machines: [] };
    render(<MachinesPage />);

    expect(screen.getByTestId('machines-empty')).toBeDefined();
    expect(screen.getByText('No machines registered')).toBeDefined();
    expect(screen.getByTestId('machines-empty-command').textContent).toBe(getDaemonStartCommand());
  });

  it('renders the load error with a retry button when the query throws', () => {
    mocks.shouldThrow = true;
    render(<MachinesPage />);

    expect(screen.getByTestId('machines-error')).toBeDefined();
    expect(screen.getByText('Could not load machines')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeDefined();
  });

  it('renders the page heading', () => {
    mocks.registry = { machines: [] };
    render(<MachinesPage />);

    expect(screen.getByRole('heading', { name: 'Machines' })).toBeDefined();
  });

  it('renders the section tabs with Machines current', () => {
    mocks.registry = { machines: [] };
    render(<MachinesPage />);

    expect(screen.getByTestId('app-section-tabs')).toBeDefined();
    expect(screen.getByTestId('app-section-tab-machines').getAttribute('aria-current')).toBe(
      'page'
    );
    expect(screen.getByTestId('app-section-tab-chatrooms').getAttribute('aria-current')).toBeNull();
  });

  it('renders cards in display-name order', () => {
    mocks.registry = { machines: [CHARLIE, BRAVO, ALPHA] };
    render(<MachinesPage />);

    expect(cardIds()).toEqual(['m-alpha', 'm-bravo', 'm-charlie']);
  });

  it('keeps card order when connectivity flips', () => {
    mocks.registry = { machines: [CHARLIE, BRAVO, ALPHA] };
    mocks.connectivity = { machines: [] };
    const { rerender } = render(<MachinesPage />);

    const before = cardIds();

    mocks.connectivity = {
      machines: [
        { machineId: 'm-charlie', connected: true },
        { machineId: 'm-bravo', connected: true },
        { machineId: 'm-alpha', connected: false },
      ],
    };
    rerender(<MachinesPage />);

    expect(cardIds()).toEqual(before);
    expect(screen.getAllByText('Online')).toHaveLength(2);
    expect(screen.getByText('Offline')).toBeDefined();
  });

  it('drops a card reactively when the registry stops returning the machine', () => {
    mocks.registry = { machines: [ALPHA, BRAVO] };
    const { rerender } = render(<MachinesPage />);

    expect(cardIds()).toEqual(['m-alpha', 'm-bravo']);

    mocks.registry = { machines: [ALPHA] };
    rerender(<MachinesPage />);
    expect(cardIds()).toEqual(['m-alpha']);

    mocks.registry = { machines: [] };
    rerender(<MachinesPage />);
    expect(screen.queryByTestId('machine-card')).toBeNull();
    expect(screen.getByTestId('machines-empty')).toBeDefined();
  });

  it('starts collapsed and mounts no roots subscription', () => {
    mocks.registry = { machines: [ALPHA] };
    render(<MachinesPage />);

    const expander = screen.getByTestId('machine-expander');
    expect(expander).toHaveAttribute('aria-expanded', 'false');
    expect(expander).toHaveAttribute('aria-label', 'Show details for Alpha');
    expect(screen.queryByTestId('machine-card-body')).toBeNull();
    expect(mocks.rootsMachineIds).toEqual([]);
  });

  it('expands on click, links the body, and keeps focus on the expander', async () => {
    const user = userEvent.setup();
    mocks.registry = { machines: [ALPHA] };
    render(<MachinesPage />);

    const expander = screen.getByTestId('machine-expander');
    await user.click(expander);

    const body = screen.getByTestId('machine-card-body');
    expect(expander).toHaveAttribute('aria-expanded', 'true');
    expect(expander).toHaveAttribute('aria-label', 'Hide details for Alpha');
    expect(expander).toHaveAttribute('aria-controls', body.id);
    expect(document.activeElement).toBe(expander);
    expect(mocks.rootsMachineIds).toEqual(['m-alpha']);
  });

  it('omits aria-controls while the card is collapsed and links the body once expanded', async () => {
    const user = userEvent.setup();
    mocks.registry = { machines: [ALPHA] };
    render(<MachinesPage />);

    const expander = screen.getByTestId('machine-expander');
    expect(expander).not.toHaveAttribute('aria-controls');

    await user.click(expander);
    expect(expander).toHaveAttribute('aria-controls', screen.getByTestId('machine-card-body').id);
  });

  it('toggles from the keyboard with Enter and Space', async () => {
    const user = userEvent.setup();
    mocks.registry = { machines: [ALPHA] };
    render(<MachinesPage />);

    const expander = screen.getByTestId('machine-expander');
    expander.focus();
    await user.keyboard('{Enter}');
    expect(expander).toHaveAttribute('aria-expanded', 'true');

    await user.keyboard(' ');
    expect(expander).toHaveAttribute('aria-expanded', 'false');
  });

  it('returns focus to the expander when collapsed by a click that did not focus it', () => {
    mocks.registry = { machines: [ALPHA] };
    render(<MachinesPage />);

    const expander = screen.getByTestId('machine-expander');
    fireEvent.click(expander);
    expect(screen.getByTestId('machine-card-body')).toBeDefined();

    screen.getByTestId('machine-actions-trigger').focus();
    fireEvent.click(expander);

    expect(screen.queryByTestId('machine-card-body')).toBeNull();
    expect(document.activeElement).toBe(expander);
  });

  it('expands only one card at a time', async () => {
    const user = userEvent.setup();
    mocks.registry = { machines: [ALPHA, BRAVO] };
    render(<MachinesPage />);

    const expanders = screen.getAllByTestId('machine-expander');
    await user.click(expanders[0]);
    expect(screen.getAllByTestId('machine-card-body')).toHaveLength(1);

    await user.click(expanders[1]);
    expect(screen.getAllByTestId('machine-card-body')).toHaveLength(1);
    expect(expanders[0]).toHaveAttribute('aria-expanded', 'false');
    expect(expanders[1]).toHaveAttribute('aria-expanded', 'true');
  });

  it('subscribes to project roots only for the expanded machine', async () => {
    const user = userEvent.setup();
    mocks.registry = { machines: [ALPHA, BRAVO] };
    render(<MachinesPage />);

    expect(mocks.rootsMachineIds).toEqual([]);

    const expanders = screen.getAllByTestId('machine-expander');
    await user.click(expanders[0]);
    expect(mocks.rootsMachineIds).toEqual(['m-alpha']);

    await user.click(expanders[1]);
    expect(mocks.rootsMachineIds).toEqual(['m-alpha', 'm-bravo']);
  });
});

describe('MachinesPage import entry point', () => {
  let consoleError: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    window.localStorage.clear();
    mocks.registry = undefined;
    mocks.connectivity = undefined;
    mocks.usage = undefined;
    mocks.lastSeen = undefined;
    mocks.capabilities = undefined;
    mocks.shouldThrow = false;
    mocks.rootsMachineIds = [];
    mocks.setMachineAlias.mockReset();
    mocks.setMachineAlias.mockResolvedValue({ success: true });
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    window.localStorage.clear();
    consoleError.mockRestore();
  });

  it('shows the interrupted import notice above the machine list', async () => {
    writeInflightImport('room-1', Date.now() - 60_000);
    mocks.registry = { machines: [ALPHA] };
    render(<MachinesPage />);

    const notice = await screen.findByTestId('interrupted-import-notice');
    const list = screen.getByTestId('machine-list');
    expect(notice.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING
    );
  });

  it('shows the interrupted import notice in the loading state', async () => {
    writeInflightImport('room-1', Date.now() - 60_000);
    render(<MachinesPage />);

    expect(screen.getByTestId('machines-loading')).toBeDefined();
    expect(await screen.findByTestId('interrupted-import-notice')).toBeInTheDocument();
  });

  it('shows the interrupted import notice in the empty state', async () => {
    writeInflightImport('room-1', Date.now() - 60_000);
    mocks.registry = { machines: [] };
    render(<MachinesPage />);

    expect(screen.getByTestId('machines-empty')).toBeDefined();
    expect(await screen.findByTestId('interrupted-import-notice')).toBeInTheDocument();
  });

  it('shows the interrupted import notice in the error state', async () => {
    writeInflightImport('room-1', Date.now() - 60_000);
    mocks.shouldThrow = true;
    render(<MachinesPage />);

    expect(screen.getByTestId('machines-error')).toBeDefined();
    expect(await screen.findByTestId('interrupted-import-notice')).toBeInTheDocument();
  });

  it('points the empty state at the machine card menu', () => {
    mocks.registry = { machines: [] };
    render(<MachinesPage />);

    expect(screen.getByTestId('machines-empty-import-hint').textContent).toContain(
      'Importing a chatroom export needs a registered machine.'
    );
  });

  it('unmounts an open import dialog when its card is removed', async () => {
    const user = userEvent.setup();
    mocks.registry = { machines: [ALPHA, BRAVO] };
    const { rerender } = render(<MachinesPage />);

    await user.click(screen.getAllByTestId('machine-actions-trigger')[0]);
    await user.click(await screen.findByTestId('machine-action-import'));
    expect(screen.getByTestId('import-dialog')).toBeInTheDocument();

    mocks.registry = { machines: [BRAVO] };
    rerender(<MachinesPage />);

    await waitFor(() => expect(screen.queryByTestId('import-dialog')).toBeNull());
  });
});
