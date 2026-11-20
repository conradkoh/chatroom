import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { FunctionReference } from 'convex/server';
import { getFunctionName } from 'convex/server';
import { ConvexError } from 'convex/values';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MachineProjectRoots, type MachineProjectRootsProps } from './MachineProjectRoots';

interface RootRow {
  rootId: string;
  path: string;
  addedAt: number;
}

interface PickerRequestRow {
  status: 'pending' | 'completed' | 'cancelled' | 'failed';
  selectedPath?: string;
  createdAt: number;
  errorMessage?: string;
}

type QueryArgs = { machineId?: string; requestId?: string } | 'skip';

const mocks = vi.hoisted(() => ({
  roots: undefined as RootRow[] | undefined,
  pickerRequest: undefined as PickerRequestRow | undefined,
  listMachineIds: [] as string[],
  add: vi.fn(),
  remove: vi.fn(),
  requestPicker: vi.fn(),
}));

vi.mock('convex-helpers/react/sessions', () => ({
  useSessionQuery: (query: unknown, args?: QueryArgs) => {
    const name = getFunctionName(query as FunctionReference<'query'>);
    if (name === 'machineProjectRoots:list') {
      const machineId = (args as { machineId: string }).machineId;
      mocks.listMachineIds.push(machineId);
      return mocks.roots === undefined ? undefined : { roots: mocks.roots };
    }
    if (name === 'folderPickerRequests:get') {
      return args === 'skip' ? undefined : mocks.pickerRequest;
    }
    throw new Error(`Unexpected query: ${name}`);
  },
  useSessionMutation: (mutation: unknown) => {
    const name = getFunctionName(mutation as FunctionReference<'mutation'>);
    if (name === 'machineProjectRoots:add') return mocks.add;
    if (name === 'machineProjectRoots:remove') return mocks.remove;
    if (name === 'folderPickerRequests:request') return mocks.requestPicker;
    throw new Error(`Unexpected mutation: ${name}`);
  },
}));

function root(id: string, path: string): RootRow {
  return { rootId: id, path, addedAt: 1 };
}

function renderSection(overrides: Partial<MachineProjectRootsProps> = {}) {
  return render(
    <MachineProjectRoots
      machineId="m-1"
      displayName="Work MacBook"
      hostname="work-host"
      alias="Work MacBook"
      connected={true}
      {...overrides}
    />
  );
}

function pathInput(): HTMLInputElement {
  return screen.getByLabelText('Project root path') as HTMLInputElement;
}

function addButton(): HTMLElement {
  return screen.getByTestId('project-roots-add');
}

describe('MachineProjectRoots', () => {
  beforeEach(() => {
    mocks.roots = undefined;
    mocks.pickerRequest = undefined;
    mocks.listMachineIds = [];
    mocks.add.mockReset();
    mocks.remove.mockReset();
    mocks.requestPicker.mockReset();
  });

  it('renders three loading skeletons before the first result', () => {
    renderSection();

    const loading = screen.getByTestId('project-roots-loading');
    expect(loading.querySelectorAll('[data-slot="skeleton"]')).toHaveLength(3);
    expect(screen.queryByTestId('project-roots-count')).toBeNull();
    expect(screen.queryByTestId('project-roots-empty')).toBeNull();
    expect(screen.queryByTestId('project-roots-list')).toBeNull();
  });

  it('renders the empty copy and a zero counter', () => {
    mocks.roots = [];
    renderSection();

    expect(screen.getByTestId('project-roots-empty').textContent).toBe(
      'No project roots yet. Add a folder so the daemon can find your git repositories.'
    );
    expect(screen.getByTestId('project-roots-count').textContent).toBe('0 / 20');
    expect(screen.getByText('Folders the daemon scans for git repositories.')).toBeDefined();
  });

  it('lists roots with a counter and a labelled remove button per row', () => {
    mocks.roots = [root('r1', '/Users/me/projects'), root('r2', '/Users/me/work')];
    renderSection();

    expect(screen.getByTestId('project-roots-count').textContent).toBe('2 / 20');
    const rows = screen.getAllByTestId('project-root-row');
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getByText('/Users/me/projects')).toBeDefined();
    expect(rows[0].querySelector('button')?.getAttribute('aria-label')).toBe(
      'Remove project root /Users/me/projects'
    );
  });

  it('removes a root by id and treats removed:false as success', async () => {
    const user = userEvent.setup();
    mocks.roots = [root('r1', '/Users/me/projects')];
    mocks.remove.mockResolvedValue({ removed: false });
    renderSection();

    await user.click(
      screen.getByRole('button', { name: 'Remove project root /Users/me/projects' })
    );

    expect(mocks.remove).toHaveBeenCalledWith({ machineId: 'm-1', rootId: 'r1' });
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  });

  it('shows the remove fallback copy, keeps the row, and retries on the next click', async () => {
    const user = userEvent.setup();
    mocks.roots = [root('r1', '/Users/me/projects')];
    mocks.remove.mockRejectedValueOnce(new Error('[CONVEX M(machineProjectRoots:remove)] boom'));
    mocks.remove.mockResolvedValue({ removed: true });
    renderSection();

    const remove = screen.getByRole('button', { name: 'Remove project root /Users/me/projects' });
    await user.click(remove);

    expect((await screen.findByRole('alert')).textContent).toBe(
      'Could not remove the folder. Try again.'
    );
    expect(screen.getByTestId('project-root-row')).toBeDefined();

    await user.click(remove);
    expect(mocks.remove).toHaveBeenCalledTimes(2);
  });

  it('marks the machine offline, disables adding, and still allows removing', async () => {
    const user = userEvent.setup();
    mocks.roots = [root('r1', '/Users/me/projects')];
    mocks.remove.mockResolvedValue({ removed: true });
    renderSection({ connected: false });

    expect(screen.getByTestId('project-roots-offline').textContent).toContain(
      'Machine is offline. Start the daemon to add roots. You can still remove roots.'
    );
    expect(pathInput()).toBeDisabled();
    expect(screen.getByRole('button', { name: /browse/i })).toBeDisabled();
    expect(addButton()).toBeDisabled();

    const remove = screen.getByRole('button', { name: 'Remove project root /Users/me/projects' });
    expect(remove).toBeEnabled();
    await user.click(remove);
    expect(mocks.remove).toHaveBeenCalledWith({ machineId: 'm-1', rootId: 'r1' });
  });

  it('keeps Add enabled while connectivity is unresolved', async () => {
    const user = userEvent.setup();
    mocks.roots = [];
    renderSection({ connected: undefined });

    expect(screen.queryByTestId('project-roots-offline')).toBeNull();
    await user.type(pathInput(), '/x');
    expect(pathInput()).toBeEnabled();
    expect(addButton()).toBeEnabled();
  });

  it('renders the limit note and disables Add at MAX_PROJECT_ROOTS', () => {
    mocks.roots = Array.from({ length: 20 }, (_, index) => root(`r${index}`, `/root/${index}`));
    renderSection();

    expect(screen.getByTestId('project-roots-count').textContent).toBe('20 / 20');
    expect(screen.getByTestId('project-roots-limit').textContent).toBe(
      "You've reached the 20 root limit. Remove a root to add another."
    );
    expect(addButton()).toBeDisabled();
    expect(pathInput()).toBeEnabled();
  });

  it('adds the trimmed typed path, clears the input and shows the success note', async () => {
    const user = userEvent.setup();
    mocks.roots = [];
    mocks.add.mockResolvedValue({ rootId: 'r9', path: '/x', collapsedPaths: [] });
    renderSection();

    await user.type(pathInput(), '  /x  ');
    await user.click(addButton());

    expect(mocks.add).toHaveBeenCalledWith({ machineId: 'm-1', path: '/x' });
    await waitFor(() => expect(pathInput().value).toBe(''));
    expect(screen.getByTestId('project-roots-success').textContent).toBe('Added /x.');
  });

  it('submits on Enter in the path input', async () => {
    const user = userEvent.setup();
    mocks.roots = [];
    mocks.add.mockResolvedValue({ rootId: 'r9', path: '/enter', collapsedPaths: [] });
    renderSection();

    await user.type(pathInput(), '/enter{Enter}');

    expect(mocks.add).toHaveBeenCalledWith({ machineId: 'm-1', path: '/enter' });
  });

  it.each([
    ['MACHINE_OFFLINE', 'This machine is offline. Start the daemon and try again.'],
    [
      'INVALID_WORKING_DIR',
      "That path isn't valid. Use an absolute folder path such as /Users/you/projects.",
    ],
    ['PROJECT_ROOT_DUPLICATE', 'That folder is already a project root.'],
    ['PROJECT_ROOT_NESTED', 'That folder is already inside an existing project root.'],
    [
      'PROJECT_ROOT_LIMIT_REACHED',
      'A machine can have up to 20 project roots. Remove one to add another.',
    ],
  ])('shows the %s copy, keeps the typed value and marks the input invalid', async (code, copy) => {
    const user = userEvent.setup();
    mocks.roots = [];
    mocks.add.mockRejectedValue(new ConvexError({ code, message: 'x' }));
    renderSection();

    const input = pathInput();
    await user.type(input, '/taken');
    await user.click(addButton());

    expect((await screen.findByTestId('project-roots-error')).textContent).toBe(copy);
    expect(input.value).toBe('/taken');
    expect(input).toHaveAttribute('aria-invalid', 'true');
  });

  it('clears the error when the user types again', async () => {
    const user = userEvent.setup();
    mocks.roots = [];
    mocks.add.mockRejectedValue(new ConvexError({ code: 'PROJECT_ROOT_DUPLICATE', message: 'x' }));
    renderSection();

    await user.type(pathInput(), '/taken');
    await user.click(addButton());
    expect(await screen.findByTestId('project-roots-error')).toBeDefined();

    await user.type(pathInput(), '2');

    expect(screen.queryByTestId('project-roots-error')).toBeNull();
    expect(pathInput()).not.toHaveAttribute('aria-invalid');
  });

  it('names the roots a collapsing add replaced', async () => {
    const user = userEvent.setup();
    mocks.roots = [root('r1', '/a/b'), root('r2', '/a/c')];
    mocks.add.mockResolvedValue({
      rootId: 'r3',
      path: '/a',
      collapsedPaths: ['/a/b', '/a/c'],
    });
    renderSection();

    await user.type(pathInput(), '/a{Enter}');

    await waitFor(() =>
      expect(screen.getByTestId('project-roots-success').textContent).toBe(
        'Added /a. Replaced 2 nested roots: /a/b, /a/c'
      )
    );
  });

  it('uses the singular noun when one root was replaced', async () => {
    const user = userEvent.setup();
    mocks.roots = [root('r1', '/a/b')];
    mocks.add.mockResolvedValue({ rootId: 'r2', path: '/a', collapsedPaths: ['/a/b'] });
    renderSection();

    await user.type(pathInput(), '/a{Enter}');

    await waitFor(() =>
      expect(screen.getByTestId('project-roots-success').textContent).toBe(
        'Added /a. Replaced 1 nested root: /a/b'
      )
    );
  });

  it('shows Adding… and disables Add while the mutation is pending', async () => {
    const user = userEvent.setup();
    mocks.roots = [];
    let resolveAdd!: (value: { rootId: string; path: string; collapsedPaths: string[] }) => void;
    mocks.add.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveAdd = resolve;
        })
    );
    renderSection();

    await user.type(pathInput(), '/slow');
    await user.click(addButton());

    expect(await screen.findByText('Adding…')).toBeDefined();
    expect(addButton()).toBeDisabled();

    resolveAdd({ rootId: 'r9', path: '/slow', collapsedPaths: [] });
    await waitFor(() =>
      expect(screen.getByTestId('project-roots-success').textContent).toBe('Added /slow.')
    );
    expect(addButton()).not.toHaveTextContent('Adding…');
  });

  it('fills the input from a completed Browse without adding it', async () => {
    const user = userEvent.setup();
    mocks.roots = [];
    mocks.requestPicker.mockResolvedValue({ requestId: 'req-1' });
    mocks.pickerRequest = {
      status: 'completed',
      selectedPath: '/Users/me/picked',
      createdAt: Date.now(),
    };
    renderSection();

    await user.click(screen.getByRole('button', { name: /browse/i }));

    await waitFor(() => expect(pathInput().value).toBe('/Users/me/picked'));
    expect(mocks.requestPicker).toHaveBeenCalledWith({ machineId: 'm-1' });
    expect(mocks.add).not.toHaveBeenCalled();
  });

  it('shows the waiting line and disables Browse while the picker is pending', async () => {
    const user = userEvent.setup();
    mocks.roots = [];
    mocks.requestPicker.mockResolvedValue({ requestId: 'req-1' });
    mocks.pickerRequest = { status: 'pending', createdAt: Date.now() };
    renderSection();

    await user.click(screen.getByRole('button', { name: /browse/i }));

    expect(
      await screen.findByText('Waiting for a folder to be selected on Work MacBook…')
    ).toBeDefined();
    expect(screen.getByRole('button', { name: /browse/i })).toBeDisabled();
  });

  it('shows the timeout retry prompt and clears it when retried', async () => {
    const user = userEvent.setup();
    mocks.roots = [];
    mocks.requestPicker.mockResolvedValue({ requestId: 'req-1' });
    mocks.pickerRequest = { status: 'pending', createdAt: Date.now() - 6 * 60_000 };
    renderSection();

    await user.click(screen.getByRole('button', { name: /browse/i }));

    const retry = await screen.findByRole('button', {
      name: 'Folder picker timed out — click to try again',
    });
    await user.click(retry);

    await waitFor(() =>
      expect(
        screen.queryByRole('button', { name: 'Folder picker timed out — click to try again' })
      ).toBeNull()
    );
  });
});
