import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { toast } from 'sonner';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { FileManagerList } from './FileManagerList';

type FileListTestItem = {
  _id: string;
  chatroomId: string;
  chatroomDeleted: boolean;
  chatroomName?: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  attachedAt?: number;
};

const mocks = vi.hoisted(() => ({
  paginated: vi.fn(),
  lastArgs: undefined as unknown,
  loadMore: vi.fn(),
  deleteFile: vi.fn(),
  fileUrls: vi.fn(),
}));

vi.mock('convex/react', () => ({
  usePaginatedQuery: (_query: unknown, args: unknown) => {
    mocks.lastArgs = args;
    return mocks.paginated();
  },
}));

vi.mock('convex-helpers/react/sessions', () => ({
  useSessionId: () => ['session-1', vi.fn()],
  useSessionQuery: (query: unknown, args: unknown) => {
    if (args === 'skip') return undefined;
    const name = String(query).split('.').pop();
    if (name === 'getFileUrls') return mocks.fileUrls();
    return undefined;
  },
  useSessionMutation: (mutation: unknown) => {
    const name = String(mutation).split('.').pop();
    if (name === 'deleteFile') return mocks.deleteFile;
    return vi.fn();
  },
}));

vi.mock('@workspace/backend/convex/_generated/api', () => ({
  api: {
    fileAttachments: {
      listFiles: 'fileAttachments.listFiles',
      getFileUrls: 'fileAttachments.getFileUrls',
      deleteFile: 'fileAttachments.deleteFile',
    },
  },
}));

vi.mock('sonner', () => {
  const toast = vi.fn();
  return { toast: Object.assign(toast, { success: vi.fn(), error: vi.fn() }) };
});

const CHATROOM_ID = 'jd7testchatroom0000000000000001' as never;
const FILE_ID = 'jd7testfile000000000000000001' as never;

function makeFile(overrides: Partial<FileListTestItem> = {}): FileListTestItem {
  return {
    _id: FILE_ID,
    chatroomId: CHATROOM_ID,
    chatroomDeleted: false,
    filename: 'a.png',
    mimeType: 'image/png',
    sizeBytes: 1048576,
    ...overrides,
  };
}

function paginationState(
  results: FileListTestItem[],
  status: 'LoadingFirstPage' | 'LoadingMore' | 'CanLoadMore' | 'Exhausted'
) {
  return { results, status, loadMore: mocks.loadMore, isLoading: status === 'LoadingFirstPage' };
}

function renderList(chatroomId?: typeof CHATROOM_ID) {
  return render(<FileManagerList chatroomId={chatroomId} />);
}

function deleteButton(filename: string) {
  return screen.getByRole('button', { name: `Delete ${filename}` });
}

describe('FileManagerList', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fileUrls.mockReturnValue([{ attachmentId: FILE_ID, url: 'https://files.example/a.png' }]);
    mocks.deleteFile.mockResolvedValue({ deleted: true });
    mocks.paginated.mockReturnValue(paginationState([makeFile()], 'Exhausted'));
  });

  it('shows three row skeletons while the first page loads', () => {
    mocks.paginated.mockReturnValue(paginationState([], 'LoadingFirstPage'));

    renderList();

    expect(document.querySelectorAll('[data-slot="skeleton"]')).toHaveLength(3);
    expect(screen.queryByTestId('file-attachment-row')).not.toBeInTheDocument();
  });

  it('shows the user-scope empty state when there are no files', () => {
    mocks.paginated.mockReturnValue(paginationState([], 'Exhausted'));

    renderList();

    expect(
      screen.getByText(
        'No files yet. Files agents attach to handoffs addressed to you appear here.'
      )
    ).toBeInTheDocument();
  });

  it('shows the chatroom-scope empty state when there are no files', () => {
    mocks.paginated.mockReturnValue(paginationState([], 'Exhausted'));

    renderList(CHATROOM_ID);

    expect(
      screen.getByText(
        'No files yet. Files agents attach to handoffs in this chatroom appear here.'
      )
    ).toBeInTheDocument();
  });

  it('requests the largest files first and switches to oldest on toggle', () => {
    renderList();

    expect(mocks.lastArgs).toEqual({ sessionId: 'session-1', sort: 'largest' });

    fireEvent.click(screen.getByRole('button', { name: 'Oldest' }));

    expect(mocks.lastArgs).toEqual({ sessionId: 'session-1', sort: 'oldest' });
  });

  it('requests the chatroom scope when a chatroom id is provided', () => {
    renderList(CHATROOM_ID);

    expect(mocks.lastArgs).toEqual({
      sessionId: 'session-1',
      sort: 'largest',
      chatroomId: CHATROOM_ID,
    });
  });

  it('loads another page from the Load more button', () => {
    mocks.paginated.mockReturnValue(paginationState([makeFile()], 'CanLoadMore'));

    renderList();
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }));

    expect(mocks.loadMore).toHaveBeenCalledWith(25);
  });

  it('shows a spinner instead of Load more while the next page loads', () => {
    mocks.paginated.mockReturnValue(paginationState([makeFile()], 'LoadingMore'));

    renderList();

    const button = screen.getByRole('button', { name: 'Load more' });
    expect(button).toBeDisabled();
    expect(button.querySelector('.animate-spin')).not.toBeNull();
  });

  it('deletes a file only after the destructive button is armed twice', async () => {
    renderList();

    fireEvent.click(deleteButton('a.png'));
    expect(mocks.deleteFile).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Confirm delete a.png' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Confirm delete a.png' }));

    await waitFor(() => {
      expect(mocks.deleteFile).toHaveBeenCalledWith({ attachmentId: FILE_ID });
    });
    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith('Deleted a.png');
    });
  });

  it('reports a row that was already removed elsewhere', async () => {
    mocks.deleteFile.mockResolvedValue({ deleted: false });

    renderList();

    fireEvent.click(deleteButton('a.png'));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm delete a.png' }));

    await waitFor(() => {
      expect(toast).toHaveBeenCalledWith('a.png was already removed');
    });
  });

  it('surfaces a delete error and returns the row to idle', async () => {
    mocks.deleteFile.mockRejectedValue({
      data: { code: 'ACCESS_DENIED', message: 'You do not have access to this attachment' },
    });

    renderList();

    fireEvent.click(deleteButton('a.png'));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm delete a.png' }));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith("You don't have access to these files.");
    });
    expect(deleteButton('a.png')).toBeInTheDocument();
  });

  it('shows an inline list error with Retry and re-subscribes', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    let failing = true;
    mocks.paginated.mockImplementation(() => {
      if (failing) throw new Error('query failed');
      return paginationState([makeFile()], 'Exhausted');
    });

    renderList();

    expect(screen.getByText("Files couldn't be loaded.")).toBeInTheDocument();

    failing = false;
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    expect(await screen.findByTestId('file-attachment-row')).toBeInTheDocument();
    errorSpy.mockRestore();
  });

  it('shows the chatroom name in the meta line for user scope', () => {
    mocks.paginated.mockReturnValue(
      paginationState([makeFile({ chatroomName: 'Design chat' })], 'Exhausted')
    );

    renderList();

    expect(screen.getByTestId('file-attachment-row').textContent).toContain('Design chat');
  });

  it('labels a live chatroom with no name as untitled, never deleted', () => {
    mocks.paginated.mockReturnValue(paginationState([makeFile()], 'Exhausted'));

    renderList();

    const meta = screen.getByTestId('file-attachment-row').textContent;
    expect(meta).toContain('Untitled chatroom');
    expect(meta).not.toContain('Deleted chatroom');
  });

  it('labels a file whose chatroom no longer exists as deleted', () => {
    mocks.paginated.mockReturnValue(
      paginationState([makeFile({ chatroomDeleted: true })], 'Exhausted')
    );

    renderList();

    expect(screen.getByTestId('file-attachment-row').textContent).toContain('Deleted chatroom');
  });
});
