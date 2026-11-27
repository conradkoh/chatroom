import { webcrypto } from 'node:crypto';

import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ChatroomTransferError } from '@workspace/backend/src/domain/entities/chatroom-transfer-file';
import { runExportBundle } from '@workspace/backend/src/domain/usecase/chatroom-transfer/export-bundle';
import type { ChatroomExportPort } from '@workspace/backend/src/domain/usecase/chatroom-transfer/export-driver';
import type { ImportChunk } from '@workspace/backend/src/domain/usecase/chatroom-transfer/import-apply';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ImportDialog } from './ImportDialog';

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  mutation: vi.fn(),
  machines: [] as unknown[],
  machinesLoading: false,
}));

vi.mock('convex/react', () => ({
  useConvex: () => ({ query: mocks.query, mutation: mocks.mutation }),
}));

vi.mock('convex-helpers/react/sessions', () => ({
  useSessionId: () => ['session-1'],
}));

vi.mock('@workspace/backend/convex/_generated/api', () => ({
  api: {
    chatroomImport: {
      preflight: { name: 'preflight' },
      begin: { name: 'begin' },
      applyChunk: { name: 'applyChunk' },
      finalize: { name: 'finalize' },
      rollback: { name: 'rollback' },
    },
  },
}));

vi.mock('@/modules/chatroom/features/machines/hooks/useMachineRows', () => ({
  useMachineRows: () => ({ rows: mocks.machines, isLoading: mocks.machinesLoading }),
}));

const AT = new Date('2026-01-02T03:04:05.000Z');
const PREFLIGHT = {
  hostname: 'host-1',
  availableHarnesses: ['opencode'],
  teamStructureKnown: true,
  invalidWorkingDirs: [],
};
const STAMP = {
  lastActivityAt: null,
  nextQueuePosition: null,
  latestMessage: null,
  taskCounts: null,
  latest: {},
  attachmentRows: { count: 0, capped: false, totalBytes: 0 },
};

const IDS = ['src-1', 'src-2', 'src-3'];

function roomRow(index: number) {
  return {
    id: `room-${index}`,
    creationTime: index,
    fields: { status: 'active', name: `Room ${index}`, teamStructureId: 'duo' },
  };
}

const EXPORT_PORT: ChatroomExportPort = {
  getStamp: async () => STAMP,
  readPage: async ({ chatroomId, category }) => {
    const index = IDS.indexOf(chatroomId) + 1;
    if (category === 'room') return { rows: [roomRow(index)], continueCursor: null, isDone: true };
    if (category === 'messages') {
      return {
        rows: [
          {
            id: `message-${index}`,
            creationTime: index,
            fields: { senderRole: 'user', content: 'hello', type: 'message' },
          },
        ],
        continueCursor: null,
        isDone: true,
      };
    }
    return { rows: [], continueCursor: null, isDone: true };
  },
};

async function bundleJson(): Promise<string> {
  const { json } = await runExportBundle(EXPORT_PORT, {
    chatroomIds: IDS,
    machineId: 'machine-src',
    cliVersion: 'webapp',
    now: () => AT,
  });
  return json;
}

/** Changes one payload without touching the index, so only that entry is not importable. */
function withBrokenEntry(json: string, index: number): string {
  const parsed = JSON.parse(json) as { chatrooms: { messages: { content: string }[] }[] };
  parsed.chatrooms[index].messages[0].content = 'tampered';
  return JSON.stringify(parsed);
}

function fileFrom(text: string, name = 'chatroom-all-export.json'): File {
  const file = new File([text], name, { type: 'application/json' });
  Object.defineProperty(file, 'text', { value: async () => text, configurable: true });
  return file;
}

function machineRow(machineId: string, displayName: string, connected: boolean | undefined) {
  return {
    machine: { machineId, hostname: `${machineId}-host`, os: 'darwin', registeredAt: 1 },
    displayName,
    connected,
    lastSeenAt: null,
    usage: undefined,
  };
}

function chunkResult(chunk: ImportChunk): { created: Record<string, string> } {
  if (chunk.phase === 'links') return { created: {} };
  return { created: Object.fromEntries(chunk.rows.map((row, index) => [row.key, `id-${index}`])) };
}

let beginCount = 0;

function installConvex(): void {
  mocks.mutation.mockImplementation(
    async (ref: { name?: string }, args: { chunk?: ImportChunk }) => {
      if (ref.name === 'begin') {
        beginCount += 1;
        return { chatroomId: `new-room-${beginCount}` };
      }
      if (ref.name === 'applyChunk' && args.chunk) return chunkResult(args.chunk);
      if (ref.name === 'finalize') return null;
      if (ref.name === 'rollback') return { drained: true, deleted: 1 };
      throw new Error(`Unexpected mutation: ${ref.name}`);
    }
  );
  mocks.query.mockImplementation(async () => PREFLIGHT);
}

function renderDialog(onClose = vi.fn()) {
  const finalFocusRef = { current: null };
  const view = render(<ImportDialog onClose={onClose} finalFocusRef={finalFocusRef} />);
  return { ...view, onClose, finalFocusRef };
}

/** The select-all checkbox is the first checkbox in the step. */
function selectAllCheckbox(): HTMLElement {
  const [first] = screen.getAllByRole('checkbox');
  if (first === undefined) throw new Error('no select-all checkbox');
  return first;
}

/** The footer Close button; the dialog header also has an X named Close. */
function footerClose(): HTMLElement {
  const [first] = screen.getAllByRole('button', { name: 'Close' });
  if (first === undefined) throw new Error('no Close button');
  return first;
}

async function upload(file: File): Promise<void> {
  const input = screen.getByTestId('import-file-input');
  await act(async () => {
    fireEvent.change(input, { target: { files: [file] } });
  });
}

beforeEach(() => {
  vi.stubGlobal('crypto', webcrypto);
  beginCount = 0;
  mocks.query.mockReset();
  mocks.mutation.mockReset();
  mocks.machines = [machineRow('machine-1', 'MacBook Pro', true)];
  mocks.machinesLoading = false;
  window.localStorage.clear();
  installConvex();
});

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

describe('ImportDialog — file step', () => {
  it('opens on the file step with focus on Choose file', async () => {
    renderDialog();
    expect(screen.getByTestId('import-dialog')).toBeInTheDocument();
    const choose = screen.getByRole('button', { name: 'Choose file…' });
    await waitFor(() => expect(choose).toHaveFocus());
    expect(screen.getByTestId('import-dropzone')).toBeInTheDocument();
  });

  it('rejects a file over the limit without reading it', async () => {
    renderDialog();
    const file = new File(['{}'], 'big.json', { type: 'application/json' });
    Object.defineProperty(file, 'size', { value: 268_435_457 });
    const text = vi.fn();
    Object.defineProperty(file, 'text', { value: text, configurable: true });

    await upload(file);

    expect(await screen.findByText('Could not read this file')).toBeInTheDocument();
    expect(screen.getByText('This file is 256 MB. The limit is 256 MB.')).toBeInTheDocument();
    expect(text).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Choose another file' })).toBeInTheDocument();
    expect(footerClose()).toBeInTheDocument();
  });

  it('reports a file that is not an export', async () => {
    renderDialog();
    await upload(fileFrom('{"kind":"other"}'));
    expect(await screen.findByText('This is not a chatroom export file.')).toBeInTheDocument();
  });

  it('drops a pending read when the dialog closes', async () => {
    const { onClose } = renderDialog();
    let release: (value: string) => void = () => {};
    const pending = new Promise<string>((resolve) => {
      release = resolve;
    });
    const file = new File([''], 'later.json', { type: 'application/json' });
    Object.defineProperty(file, 'text', { value: () => pending, configurable: true });

    await upload(file);
    expect(screen.getByText(/Reading later\.json…/)).toBeInTheDocument();

    fireEvent.click(footerClose());
    await waitFor(() => expect(onClose).toHaveBeenCalled());

    release('{"kind":"other"}');
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('ImportDialog — select step', () => {
  it('lists the entries and marks one as not importable', async () => {
    renderDialog();
    await upload(fileFrom(withBrokenEntry(await bundleJson(), 2)));

    expect(await screen.findByTestId('import-entry-list')).toBeInTheDocument();
    expect(screen.getByText('Room 1')).toBeInTheDocument();
    expect(screen.getByText('not importable: IMPORT_CHECKSUM_MISMATCH')).toBeInTheDocument();
    expect(screen.getByText('3 chatrooms · 1 not importable')).toBeInTheDocument();
    expect(screen.getByText('Select all (2 importable)')).toBeInTheDocument();

    const entries = screen.getAllByTestId('import-entry');
    const broken = entries.find((entry) => entry.dataset.key === 'src-3');
    expect(broken).toBeDefined();
    expect(within(broken as HTMLElement).getByRole('checkbox')).toHaveAttribute('data-disabled');
    await waitFor(() => expect(selectAllCheckbox()).toHaveFocus());
  });

  it('toggles a focused row with the Space key', async () => {
    renderDialog();
    await upload(fileFrom(await bundleJson()));
    const entries = await screen.findAllByTestId('import-entry');
    const first = within(entries[0] as HTMLElement).getByRole('checkbox');

    act(() => first.focus());
    fireEvent.keyDown(first, { key: ' ' });
    fireEvent.keyUp(first, { key: ' ' });
    expect(screen.getByText('1 selected')).toBeInTheDocument();
  });

  it('selects all importable entries with Ctrl+A and shows tristate select-all', async () => {
    renderDialog();
    await upload(fileFrom(await bundleJson()));
    const list = await screen.findByTestId('import-entry-list');
    const entries = screen.getAllByTestId('import-entry');

    fireEvent.click(within(entries[0] as HTMLElement).getByRole('checkbox'));
    expect(screen.getByText('1 selected')).toBeInTheDocument();

    fireEvent.keyDown(list, { key: 'a', ctrlKey: true });
    expect(screen.getByText('3 selected')).toBeInTheDocument();
    const selectAll = selectAllCheckbox();
    expect(selectAll).toHaveAttribute('data-checked');

    fireEvent.click(within(entries[0] as HTMLElement).getByRole('checkbox'));
    expect(screen.getByText('2 selected')).toBeInTheDocument();
    expect(selectAll).toHaveAttribute('data-indeterminate');
  });

  it('moves focus between rows with the arrow keys', async () => {
    renderDialog();
    await upload(fileFrom(await bundleJson()));
    const entries = await screen.findAllByTestId('import-entry');
    const first = within(entries[0] as HTMLElement).getByRole('checkbox');
    const second = within(entries[1] as HTMLElement).getByRole('checkbox');

    first.focus();
    fireEvent.keyDown(screen.getByTestId('import-entry-list'), { key: 'ArrowDown' });
    expect(second).toHaveFocus();
    fireEvent.keyDown(screen.getByTestId('import-entry-list'), { key: 'Home' });
    expect(first).toHaveFocus();
    fireEvent.keyDown(screen.getByTestId('import-entry-list'), { key: 'End' });
    expect(within(entries[2] as HTMLElement).getByRole('checkbox')).toHaveFocus();
  });

  it('disables Import with a visible reason until a selection exists', async () => {
    renderDialog();
    await upload(fileFrom(await bundleJson()));

    const start = await screen.findByTestId('import-start');
    expect(start).toBeDisabled();
    expect(start).toHaveAttribute('aria-describedby', 'import-disabled-reason');
    expect(screen.getByText('Select at least one chatroom.')).toBeInTheDocument();

    fireEvent.click(selectAllCheckbox());
    expect(start).toBeEnabled();
    expect(screen.getByText('3 of 3 selected → MacBook Pro')).toBeInTheDocument();
  });

  it('preselects the only owned machine and lets an offline machine be chosen', async () => {
    mocks.machines = [machineRow('machine-1', 'Cloud box', false)];
    renderDialog();
    await upload(fileFrom(await bundleJson()));

    expect(await screen.findByText('Offline')).toBeInTheDocument();
    expect(screen.getByText('Cloud box')).toBeInTheDocument();
    expect(
      screen.getByText(
        'Cloud box is offline. The chatrooms are created now; agents cannot start until its daemon runs.'
      )
    ).toBeInTheDocument();
    expect(screen.getByTestId('import-start')).toBeDisabled();
  });

  it('asks for a machine when several are owned', async () => {
    mocks.machines = [
      machineRow('machine-1', 'MacBook Pro', true),
      machineRow('machine-2', 'Cloud box', undefined),
    ];
    renderDialog();
    await upload(fileFrom(await bundleJson()));
    await screen.findByTestId('import-start');
    fireEvent.click(selectAllCheckbox());

    expect(screen.getByText('Checking…')).toBeInTheDocument();
    expect(screen.getByText('Choose a machine.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('radio', { name: /Cloud box/ }));
    expect(screen.getByTestId('import-start')).toBeEnabled();
  });

  it('shows the register link when no machine is owned', async () => {
    mocks.machines = [];
    renderDialog();
    await upload(fileFrom(await bundleJson()));

    expect(await screen.findByText('Register a machine')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Register a machine' })).toHaveAttribute(
      'href',
      '/app/machines'
    );
  });

  it('shows an empty file message without the machine section', async () => {
    const emptyBundle = await runExportBundle(EXPORT_PORT, {
      chatroomIds: [],
      machineId: 'machine-src',
      cliVersion: 'webapp',
      now: () => AT,
    });
    renderDialog();
    await upload(fileFrom(emptyBundle.json));

    expect((await screen.findAllByText('This file contains no chatrooms.')).length).toBeGreaterThan(
      0
    );
    expect(screen.queryByText('Import to machine')).not.toBeInTheDocument();
  });
});

describe('ImportDialog — progress and results', () => {
  it('confirms the stop inline, then lands on Import stopped', async () => {
    let releaseChunk: () => void = () => {};
    const chunkGate = new Promise<void>((resolve) => {
      releaseChunk = resolve;
    });
    mocks.mutation.mockImplementation(
      async (ref: { name?: string }, args: { chunk?: ImportChunk }) => {
        if (ref.name === 'begin') return { chatroomId: 'new-room-1' };
        if (ref.name === 'applyChunk' && args.chunk) {
          await chunkGate;
          return chunkResult(args.chunk);
        }
        if (ref.name === 'finalize') return null;
        if (ref.name === 'rollback') return { drained: true, deleted: 1 };
        throw new Error(`Unexpected mutation: ${ref.name}`);
      }
    );

    const { onClose } = renderDialog();
    await upload(fileFrom(await bundleJson()));
    await screen.findByTestId('import-start');
    fireEvent.click(selectAllCheckbox());
    fireEvent.click(screen.getByTestId('import-start'));

    const stop = await screen.findByTestId('import-stop');
    expect(
      screen.getByText(/Importing 1 of 3 · Keep this tab open until it finishes\./)
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /close/i })).not.toBeInTheDocument();

    fireEvent.click(stop);
    const keep = await screen.findByTestId('import-stop-keep');
    expect(keep).toHaveFocus();
    expect(screen.getByText('Stop importing?')).toBeInTheDocument();

    fireEvent.click(keep);
    await waitFor(() => expect(screen.getByTestId('import-stop')).toBeInTheDocument());

    fireEvent.click(screen.getByTestId('import-stop'));
    fireEvent.click(await screen.findByTestId('import-stop-confirm'));

    expect(await screen.findByText('Stopping import…')).toBeInTheDocument();
    // Esc and the overlay are ignored while stopping.
    fireEvent.keyDown(screen.getByTestId('import-dialog'), { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();

    releaseChunk();
    expect(await screen.findByTestId('import-summary')).toHaveTextContent(
      'Imported 0 of 3 selected · Failed 1 · Not started 2'
    );
    expect(screen.getByRole('heading', { name: 'Import stopped' })).toBeInTheDocument();
  });

  it('shows partial results with working links and a retry', async () => {
    mocks.mutation.mockImplementation(
      async (ref: { name?: string }, args: { chunk?: ImportChunk }) => {
        if (ref.name === 'begin') {
          beginCount += 1;
          if (beginCount === 3) {
            throw new ChatroomTransferError('IMPORT_CHUNK_FAILED', 'could not start the room');
          }
          return { chatroomId: `new-room-${beginCount}` };
        }
        if (ref.name === 'applyChunk' && args.chunk) return chunkResult(args.chunk);
        if (ref.name === 'finalize') return null;
        if (ref.name === 'rollback') return { drained: true, deleted: 1 };
        throw new Error(`Unexpected mutation: ${ref.name}`);
      }
    );

    renderDialog();
    await upload(fileFrom(await bundleJson()));
    await screen.findByTestId('import-start');
    fireEvent.click(selectAllCheckbox());
    fireEvent.click(screen.getByTestId('import-start'));

    expect(await screen.findByTestId('import-summary')).toHaveTextContent(
      'Imported 2 of 3 selected · Failed 1'
    );
    const imported = screen.getByTestId('import-results-imported');
    expect(within(imported).getAllByRole('link', { name: /Open/ })[0]).toHaveAttribute(
      'href',
      '/app/chatroom?id=new-room-1'
    );
    const failed = screen.getByTestId('import-results-failed');
    expect(within(failed).getByText(/IMPORT_CHUNK_FAILED/)).toBeInTheDocument();
    expect(within(failed).getByText('Nothing was created.')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('import-retry'));
    expect(await screen.findByTestId('import-entry-list')).toBeInTheDocument();
    expect(screen.getByText('1 selected')).toBeInTheDocument();
    expect(screen.getAllByText('Already imported')).toHaveLength(2);
  });

  it('closes on a plain click of an imported chatroom link', async () => {
    const { onClose } = renderDialog();
    await upload(fileFrom(await bundleJson()));
    await screen.findByTestId('import-start');
    fireEvent.click(selectAllCheckbox());
    fireEvent.click(screen.getByTestId('import-start'));

    const imported = await screen.findByTestId('import-results-imported');
    const link = within(imported).getAllByRole('link', { name: /Open/ })[0];
    expect(link).toHaveAttribute('href', '/app/chatroom?id=new-room-1');

    fireEvent.click(link);
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('applies the dialog width overrides', () => {
    renderDialog();
    const dialog = screen.getByTestId('import-dialog');
    expect(dialog).toHaveClass('flex!', 'max-w-[calc(100%-1rem)]!', 'sm:max-w-2xl!', 'gap-3!');
  });
});
