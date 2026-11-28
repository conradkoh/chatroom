import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SetupFolderPickerField } from './SetupFolderPickerField';
import { useSetupWorkspaceFolderPicker } from './useSetupWorkspaceFolderPicker';
import { resetOverlayDismissStackForTests } from '../shared/overlayDismissStack';

/**
 * Field and hook together, with only the Convex session adapter stubbed. The panel, the state
 * owner and the query/mutation wiring are all real; what the test controls is the daemon's answer.
 */

const queryState = vi.hoisted(() => ({
  header: undefined as unknown,
  listing: undefined as unknown,
}));

const mutations = vi.hoisted(() => ({
  open: vi.fn(),
  navigate: vi.fn(),
  close: vi.fn(),
}));

vi.mock('convex-helpers/react/sessions', () => ({
  useSessionQuery: (fn: string, args: unknown) => {
    if (args === 'skip') return undefined;
    if (fn === 'folderBrowse:get') return queryState.header;
    if (fn === 'folderBrowse:getListing') return queryState.listing;
    return undefined;
  },
  useSessionMutation: (fn: string) => {
    if (fn === 'folderBrowse:open') return mutations.open;
    if (fn === 'folderBrowse:navigate') return mutations.navigate;
    return mutations.close;
  },
}));

vi.mock('@workspace/backend/convex/_generated/api', () => ({
  api: {
    folderBrowse: {
      open: 'folderBrowse:open',
      navigate: 'folderBrowse:navigate',
      close: 'folderBrowse:close',
      get: 'folderBrowse:get',
      getListing: 'folderBrowse:getListing',
    },
  },
}));

const BROWSE_ID = 'jd7browse0000000000000000001';
const TEN_MINUTES_MS = 10 * 60_000;
const WAITING_TEXT = 'Waiting for folder selection on laptop-m2...';

function readyHeader(overrides: Record<string, unknown> = {}) {
  return {
    browseId: BROWSE_ID,
    machineId: 'machine-1',
    state: 'ready',
    navSeq: 1,
    requestedPath: '/srv/app',
    showHidden: false,
    filter: null,
    pendingSince: null,
    error: null,
    expiresAt: Date.now() + TEN_MINUTES_MS,
    ...overrides,
  };
}

function listingView(path: string, names: string[]) {
  return {
    seq: 1,
    requestedPath: path,
    path,
    parentPath: path.slice(0, path.lastIndexOf('/')) || '/',
    entries: names.map((name) => ({ name })),
    dirCount: names.length,
    fileCount: 0,
    hiddenCount: 0,
    truncated: false,
    complete: true,
    selectable: true,
    fellBack: false,
    listedAt: Date.now(),
  };
}

/** A real field driven by the real hook. `onPathSelected` writes the chosen path into `value`. */
function Harness({ onSelectedSpy }: { onSelectedSpy?: (path: string) => void }) {
  const [value, setValue] = useState('');
  const { picker, reset } = useSetupWorkspaceFolderPicker({
    selectedMachineId: 'machine-1',
    selectedMachine: { hostname: 'laptop-m2' },
    onPathSelected: (path) => {
      setValue(path);
      onSelectedSpy?.(path);
    },
  });
  return (
    <>
      <SetupFolderPickerField
        variant="setup"
        heading="Workspace Folder"
        inputAriaLabel="Folder path"
        waitingText={WAITING_TEXT}
        value={value}
        onChange={setValue}
        placeholder="Select a folder"
        inputDisabled={false}
        browseDisabled={false}
        picker={picker}
      />
      <button type="button" onClick={reset}>
        Reset
      </button>
    </>
  );
}

function input() {
  return screen.getByRole('textbox', { name: 'Folder path' });
}

function browseButton() {
  return screen.getByRole('button', { name: 'Browse' });
}

describe('SetupFolderPickerField with useSetupWorkspaceFolderPicker', () => {
  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn();
    resetOverlayDismissStackForTests();
    queryState.header = undefined;
    queryState.listing = undefined;
    mutations.open.mockReset().mockResolvedValue({ browseId: BROWSE_ID });
    mutations.navigate.mockReset().mockResolvedValue(null);
    mutations.close.mockReset().mockResolvedValue(null);
  });

  it('Browse with an empty value opens the machine home, and the panel mounts under the input', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(browseButton());

    await waitFor(() => expect(mutations.open).toHaveBeenCalledWith({ machineId: 'machine-1' }));
    expect(browseButton()).toHaveAttribute('aria-expanded', 'true');
    const region = await screen.findByRole('region');
    expect(browseButton()).toHaveAttribute('aria-controls', region.id);
  });

  it('Browse with a typed absolute path opens at that path', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.type(input(), '/srv/app');
    await user.click(browseButton());

    await waitFor(() =>
      expect(mutations.open).toHaveBeenCalledWith({ machineId: 'machine-1', path: '/srv/app' })
    );
  });

  it('a ready listing lets the user pick a folder, which fills the input and closes the session', async () => {
    const user = userEvent.setup();
    const onSelected = vi.fn();
    queryState.header = readyHeader();
    queryState.listing = listingView('/srv/app', ['alpha', 'beta']);
    const { rerender } = render(<Harness onSelectedSpy={onSelected} />);

    await user.click(browseButton());
    await screen.findByRole('button', { name: 'alpha' });

    await user.click(screen.getByRole('button', { name: 'alpha' }));
    await waitFor(() =>
      expect(mutations.navigate).toHaveBeenCalledWith(
        expect.objectContaining({ browseId: BROWSE_ID, path: '/srv/app/alpha' })
      )
    );

    queryState.listing = listingView('/srv/app/alpha', ['nested']);
    rerender(<Harness onSelectedSpy={onSelected} />);
    await user.click(screen.getByRole('button', { name: 'Select' }));

    expect(input()).toHaveValue('/srv/app/alpha');
    expect(onSelected).toHaveBeenCalledWith('/srv/app/alpha');
    await waitFor(() => expect(mutations.close).toHaveBeenCalledWith({ browseId: BROWSE_ID }));
    expect(screen.queryByRole('region')).not.toBeInTheDocument();
    expect(input()).toHaveFocus();
  });

  it('Cancel leaves the input unchanged, closes the session, and returns focus to Browse', async () => {
    const user = userEvent.setup();
    queryState.header = readyHeader();
    queryState.listing = listingView('/srv/app', ['alpha']);
    render(<Harness />);
    await user.type(input(), '/srv/typed');

    await user.click(browseButton());
    await screen.findByRole('button', { name: 'alpha' });
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(input()).toHaveValue('/srv/typed');
    await waitFor(() => expect(mutations.close).toHaveBeenCalledWith({ browseId: BROWSE_ID }));
    expect(screen.queryByRole('region')).not.toBeInTheDocument();
    expect(browseButton()).toHaveFocus();
  });

  it('an error state shows inside the panel, not as a field line, and the waiting line is gone', async () => {
    const user = userEvent.setup();
    queryState.header = readyHeader({
      state: 'error',
      error: { code: 'READ_FAILED', message: 'denied', path: '/srv/app' },
    });
    render(<Harness />);

    await user.click(browseButton());

    expect(
      await screen.findByText('Could not read /srv/app. Try again or choose another folder.')
    ).toBeInTheDocument();
    expect(screen.queryByText(WAITING_TEXT)).not.toBeInTheDocument();
    expect(screen.queryByText('Failed to browse folder')).not.toBeInTheDocument();
  });

  it('an open rejection shows the field error line, and the next Browse clears it', async () => {
    const user = userEvent.setup();
    mutations.open.mockRejectedValueOnce('offline');
    render(<Harness />);

    await user.click(browseButton());

    expect(await screen.findByText('Failed to browse folder')).toBeInTheDocument();
    expect(screen.queryByRole('region')).not.toBeInTheDocument();

    mutations.open.mockResolvedValueOnce({ browseId: BROWSE_ID });
    await user.click(browseButton());

    await waitFor(() =>
      expect(screen.queryByText('Failed to browse folder')).not.toBeInTheDocument()
    );
  });

  it('reset closes an open session', async () => {
    const user = userEvent.setup();
    queryState.header = readyHeader();
    queryState.listing = listingView('/srv/app', ['alpha']);
    render(<Harness />);
    await user.click(browseButton());
    await screen.findByRole('button', { name: 'alpha' });

    await user.click(screen.getByRole('button', { name: 'Reset' }));

    await waitFor(() => expect(mutations.close).toHaveBeenCalledWith({ browseId: BROWSE_ID }));
    expect(screen.queryByRole('region')).not.toBeInTheDocument();
  });

  it('reset clears an open error line', async () => {
    const user = userEvent.setup();
    mutations.open.mockRejectedValueOnce('offline');
    render(<Harness />);
    await user.click(browseButton());
    expect(await screen.findByText('Failed to browse folder')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Reset' }));

    expect(screen.queryByText('Failed to browse folder')).not.toBeInTheDocument();
  });

  it('unmounting while open closes the session on the server', async () => {
    const user = userEvent.setup();
    queryState.header = readyHeader();
    queryState.listing = listingView('/srv/app', ['alpha']);
    const { unmount } = render(<Harness />);
    await user.click(browseButton());
    await screen.findByRole('button', { name: 'alpha' });

    unmount();

    await waitFor(() => expect(mutations.close).toHaveBeenCalledWith({ browseId: BROWSE_ID }));
  });

  it('typing in the input while the panel is open neither navigates nor closes it', async () => {
    const user = userEvent.setup();
    queryState.header = readyHeader();
    queryState.listing = listingView('/srv/app', ['alpha']);
    render(<Harness />);
    await user.click(browseButton());
    await screen.findByRole('button', { name: 'alpha' });

    fireEvent.change(input(), { target: { value: '/srv/elsewhere' } });

    expect(input()).toHaveValue('/srv/elsewhere');
    expect(mutations.navigate).not.toHaveBeenCalled();
    expect(screen.getByRole('region')).toBeInTheDocument();
  });
});
