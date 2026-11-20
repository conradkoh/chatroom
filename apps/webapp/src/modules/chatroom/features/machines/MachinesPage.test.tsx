import { render, screen, within } from '@testing-library/react';
import type { FunctionReference } from 'convex/server';
import { getFunctionName } from 'convex/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MachinesPage } from './MachinesPage';
import type { UserMachine } from '../../types/machine';

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
  shouldThrow: false,
  setMachineAlias: vi.fn(),
}));

vi.mock('convex-helpers/react/sessions', () => ({
  useSessionQuery: (query: unknown, args?: { machineId?: string }) => {
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
        return mocks.capabilities?.[args?.machineId ?? ''];
      default:
        throw new Error(`Unexpected query: ${name}`);
    }
  },
  useSessionMutation: () => mocks.setMachineAlias,
}));

vi.mock('next/navigation', () => ({
  usePathname: () => '/app/machines',
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
});
