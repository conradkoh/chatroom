import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PurgeFilesDialog } from './PurgeFilesDialog';

type FileListTestItem = {
  _id: string;
  chatroomId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
};

const mocks = vi.hoisted(() => ({
  paginated: vi.fn(),
  loadMore: vi.fn(),
  purgeFiles: vi.fn(),
}));

vi.mock('convex/react', () => ({
  usePaginatedQuery: () => mocks.paginated(),
}));

vi.mock('convex-helpers/react/sessions', () => ({
  useSessionId: () => ['session-1', vi.fn()],
  useSessionMutation: (mutation: unknown) => {
    const name = String(mutation).split('.').pop();
    if (name === 'purgeFiles') return mocks.purgeFiles;
    return vi.fn();
  },
}));

vi.mock('@workspace/backend/convex/_generated/api', () => ({
  api: {
    fileAttachments: {
      listFiles: 'fileAttachments.listFiles',
      purgeFiles: 'fileAttachments.purgeFiles',
    },
  },
}));

const MB = 1024 * 1024;
const CHATROOM_ID = 'jd7testchatroom0000000000000001' as never;

function makeFile(index: number, sizeBytes: number): FileListTestItem {
  return {
    _id: `jd7testfile${index}`,
    chatroomId: CHATROOM_ID,
    filename: `file-${index}.png`,
    mimeType: 'image/png',
    sizeBytes,
  };
}

function paginationState(
  results: FileListTestItem[],
  status: 'LoadingFirstPage' | 'LoadingMore' | 'CanLoadMore' | 'Exhausted'
) {
  return { results, status, loadMore: mocks.loadMore, isLoading: status === 'LoadingFirstPage' };
}

function renderDialog({
  minSizeBytes = 0,
  chatroomId,
  onPurged = vi.fn(),
  onOpenChange = vi.fn(),
}: {
  minSizeBytes?: number;
  chatroomId?: typeof CHATROOM_ID;
  onPurged?: (result: { deleted: number; continuing: boolean }) => void;
  onOpenChange?: (open: boolean) => void;
} = {}) {
  return render(
    <PurgeFilesDialog
      open
      onOpenChange={onOpenChange}
      chatroomId={chatroomId}
      minSizeBytes={minSizeBytes}
      onPurged={onPurged}
    />
  );
}

function actionButton() {
  return screen.getByRole('button', { name: /^(Delete|Deleting)/ });
}

describe('PurgeFilesDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.purgeFiles.mockResolvedValue({ deleted: 2, continuing: false });
    mocks.paginated.mockReturnValue(paginationState([], 'Exhausted'));
  });

  it('shows Calculating while the first preview page loads and disables confirm', () => {
    mocks.paginated.mockReturnValue(paginationState([], 'LoadingFirstPage'));

    renderDialog();

    expect(screen.getByText('Calculating…')).toBeInTheDocument();
    expect(actionButton()).toBeDisabled();
  });

  it('counts only files at or above the size threshold', () => {
    mocks.paginated.mockReturnValue(
      paginationState(
        [makeFile(1, 5 * MB), makeFile(2, 2 * MB), makeFile(3, 512 * 1024)],
        'Exhausted'
      )
    );

    renderDialog({ minSizeBytes: MB, chatroomId: CHATROOM_ID });

    expect(
      screen.getByText(
        '2 files · 7 MB larger than 1 MB will be permanently deleted from this chatroom.'
      )
    ).toBeInTheDocument();
    expect(
      screen.getByText('Agents\' handoffs will show them as "File removed". This can\'t be undone.')
    ).toBeInTheDocument();
    expect(actionButton()).toHaveTextContent('Delete 2 files');
  });

  it('loads more pages while the last file still qualifies', async () => {
    mocks.paginated.mockReturnValue(paginationState([makeFile(1, 2 * MB)], 'CanLoadMore'));

    renderDialog({ minSizeBytes: MB });

    await waitFor(() => {
      expect(mocks.loadMore).toHaveBeenCalledWith(25);
    });
  });

  it('stops loading once the last file is below the threshold', () => {
    mocks.paginated.mockReturnValue(paginationState([makeFile(1, 512 * 1024)], 'CanLoadMore'));

    renderDialog({ minSizeBytes: MB });

    expect(mocks.loadMore).not.toHaveBeenCalled();
  });

  it('caps the preview at 250 files and says there may be more', () => {
    const files = Array.from({ length: 250 }, (_, index) => makeFile(index, 2 * MB));
    mocks.paginated.mockReturnValue(paginationState(files, 'CanLoadMore'));

    renderDialog({ minSizeBytes: MB, chatroomId: CHATROOM_ID });

    expect(screen.getByText(/More than 250 files · at least/)).toBeInTheDocument();
    expect(actionButton()).toHaveTextContent('Delete files');
    expect(mocks.loadMore).not.toHaveBeenCalled();
  });

  it('shows no-match copy and disables confirm when nothing qualifies', () => {
    mocks.paginated.mockReturnValue(paginationState([makeFile(1, 512 * 1024)], 'Exhausted'));

    renderDialog({ minSizeBytes: 5 * MB });

    expect(screen.getByText('No files match this size.')).toBeInTheDocument();
    expect(actionButton()).toBeDisabled();
  });

  it('passes undefined threshold and chatroom for Any size at user scope', async () => {
    const onPurged = vi.fn();
    const onOpenChange = vi.fn();
    mocks.paginated.mockReturnValue(
      paginationState([makeFile(1, 5 * MB), makeFile(2, 2 * MB)], 'Exhausted')
    );

    renderDialog({ minSizeBytes: 0, onPurged, onOpenChange });
    fireEvent.click(actionButton());

    await waitFor(() => {
      expect(mocks.purgeFiles).toHaveBeenCalledWith({
        chatroomId: undefined,
        minSizeBytes: undefined,
      });
    });
    expect(onPurged).toHaveBeenCalledWith({ deleted: 2, continuing: false });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('passes the exact chatroom and byte threshold for 1 MB', async () => {
    mocks.paginated.mockReturnValue(paginationState([makeFile(1, 2 * MB)], 'Exhausted'));

    renderDialog({ minSizeBytes: MB, chatroomId: CHATROOM_ID });
    fireEvent.click(actionButton());

    await waitFor(() => {
      expect(mocks.purgeFiles).toHaveBeenCalledWith({
        chatroomId: CHATROOM_ID,
        minSizeBytes: 1048576,
      });
    });
  });

  it('reports a continuing purge to the caller', async () => {
    const onPurged = vi.fn();
    mocks.purgeFiles.mockResolvedValue({ deleted: 3, continuing: true });
    mocks.paginated.mockReturnValue(paginationState([makeFile(1, 2 * MB)], 'Exhausted'));

    renderDialog({ minSizeBytes: MB, onPurged });
    fireEvent.click(actionButton());

    await waitFor(() => {
      expect(onPurged).toHaveBeenCalledWith({ deleted: 3, continuing: true });
    });
  });

  it('shows an error line and lets the user retry', async () => {
    mocks.purgeFiles.mockRejectedValueOnce({
      data: { code: 'ACCESS_DENIED', message: 'You do not have access to these files' },
    });
    mocks.paginated.mockReturnValue(paginationState([makeFile(1, 2 * MB)], 'Exhausted'));

    renderDialog({ minSizeBytes: MB });

    fireEvent.click(actionButton());

    expect(await screen.findByText("You don't have access to these files.")).toBeInTheDocument();
    expect(actionButton()).toBeEnabled();

    fireEvent.click(actionButton());

    await waitFor(() => {
      expect(mocks.purgeFiles).toHaveBeenCalledTimes(2);
    });
  });
});
