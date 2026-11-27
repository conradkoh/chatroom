import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { InterruptedImportNotice } from './InterruptedImportNotice';
import {
  INFLIGHT_IMPORT_STALE_MS,
  INFLIGHT_IMPORT_STORAGE_KEY,
  readInflightImport,
} from '../lib/inflightImport';

const mocks = vi.hoisted(() => ({ mutation: vi.fn() }));

vi.mock('convex/react', () => ({
  useConvex: () => ({ mutation: mocks.mutation }),
}));

vi.mock('convex-helpers/react/sessions', () => ({
  useSessionId: () => ['session-1'],
}));

vi.mock('@workspace/backend/convex/_generated/api', () => ({
  api: { chatroomImport: { rollback: { name: 'rollback' } } },
}));

const NOW = 2_000_000_000_000;

function writeRecord(heartbeatAt: number): void {
  window.localStorage.setItem(
    INFLIGHT_IMPORT_STORAGE_KEY,
    JSON.stringify({ chatroomId: 'room-1', startedAt: NOW - 60_000, heartbeatAt })
  );
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
  vi.setSystemTime(NOW);
  mocks.mutation.mockReset();
  window.localStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
  window.localStorage.clear();
});

describe('InterruptedImportNotice', () => {
  it('renders nothing without a record', () => {
    const { container } = render(<InterruptedImportNotice />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing while the heartbeat is fresh', () => {
    writeRecord(NOW);
    const { container } = render(<InterruptedImportNotice />);
    expect(container).toBeEmptyDOMElement();
  });

  it('offers to remove a stale record', () => {
    writeRecord(NOW - INFLIGHT_IMPORT_STALE_MS - 1);
    render(<InterruptedImportNotice className="mb-4" />);

    expect(screen.getByTestId('interrupted-import-notice')).toBeInTheDocument();
    expect(screen.getByText('An import was interrupted')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove incomplete chatroom' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Keep it' })).toBeInTheDocument();
  });

  it('removes the incomplete chatroom and clears the record', async () => {
    writeRecord(NOW - INFLIGHT_IMPORT_STALE_MS - 1);
    let release: (value: unknown) => void = () => {};
    const gate = new Promise<unknown>((resolve) => {
      release = resolve;
    });
    mocks.mutation.mockReturnValueOnce(gate).mockResolvedValueOnce({ drained: true, deleted: 1 });
    render(<InterruptedImportNotice />);

    fireEvent.click(screen.getByRole('button', { name: 'Remove incomplete chatroom' }));
    expect(await screen.findByText('Removing…')).toBeInTheDocument();

    release({ drained: false, deleted: 3 });
    await waitFor(() =>
      expect(screen.getByText('Removed the incomplete chatroom.')).toBeInTheDocument()
    );
    expect(mocks.mutation).toHaveBeenCalledTimes(2);
    expect(readInflightImport()).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
  });

  it('keeps the record and offers both actions when removal fails', async () => {
    writeRecord(NOW - INFLIGHT_IMPORT_STALE_MS - 1);
    mocks.mutation.mockResolvedValue({ drained: false, deleted: 0 });
    render(<InterruptedImportNotice />);

    fireEvent.click(screen.getByRole('button', { name: 'Remove incomplete chatroom' }));

    expect(await screen.findByText(/Could not remove it:/)).toBeInTheDocument();
    expect(readInflightImport()).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Remove incomplete chatroom' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Dismiss' })).toBeInTheDocument();
  });

  it('Keep it clears the record and hides the notice', async () => {
    writeRecord(NOW - INFLIGHT_IMPORT_STALE_MS - 1);
    render(<InterruptedImportNotice />);

    fireEvent.click(screen.getByRole('button', { name: 'Keep it' }));

    await waitFor(() => expect(screen.queryByTestId('interrupted-import-notice')).toBeNull());
    expect(readInflightImport()).toBeNull();
  });
});
