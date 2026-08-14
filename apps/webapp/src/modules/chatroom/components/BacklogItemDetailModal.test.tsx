/**
 * BacklogItemDetailModal — editor initialization and delete action.
 *
 * Backlog-status items open directly in the WYSIWYG editor; other statuses
 * open in read-only markdown view. Delete action shows confirmation dialog.
 */

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { BacklogItem } from './backlog';
import { BacklogItemDetailModal } from './BacklogItemDetailModal';

const mockDeleteBacklogItem = vi.fn().mockResolvedValue({ success: true });

vi.mock('next/dynamic', () => ({
  default: () => {
    const MockEditor = (props: Record<string, unknown>) => {
      const { defaultMarkdown = '', onChange, ...rest } = props as {
        defaultMarkdown?: string;
        onChange: (md: string) => void;
      };
      return (
        <textarea
          data-testid="backlog-rich-text-editor"
          value={defaultMarkdown}
          onChange={(e) => onChange(e.target.value)}
          {...rest}
        />
      );
    };
    MockEditor.displayName = 'MockRichTextEditor';
    return MockEditor;
  },
}));

vi.mock('convex-helpers/react/sessions', () => ({
  useSessionMutation: (ref: unknown) => {
    if (ref === 'backlog:deleteBacklogItem') return mockDeleteBacklogItem;
    return vi.fn().mockResolvedValue(undefined);
  },
  useSessionQuery: () => undefined,
}));

vi.mock('@workspace/backend/convex/_generated/api', () => ({
  api: {
    backlog: {
      deleteBacklogItem: 'backlog:deleteBacklogItem',
      markBacklogItemForReview: 'backlog:markBacklogItemForReview',
      completeBacklogItem: 'backlog:completeBacklogItem',
      sendBacklogItemBackForRework: 'backlog:sendBacklogItemBackForRework',
      reopenBacklogItem: 'backlog:reopenBacklogItem',
      closeBacklogItem: 'backlog:closeBacklogItem',
      updateBacklogItem: 'backlog:updateBacklogItem',
    },
  },
}));

vi.mock('../attachments', () => ({
  useAttachments: () => ({ add: vi.fn(), isAttached: () => false }),
}));

vi.mock('./ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: { children: React.ReactNode; asChild?: boolean }) => (
    <div>{children}</div>
  ),
  DropdownMenuContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuItem: ({
    children,
    onClick,
  }: {
    children: React.ReactNode;
    onClick?: () => void;
  }) => <button onClick={onClick}>{children}</button>,
  DropdownMenuSeparator: () => <hr />,
}));

vi.mock('./ui/alert-dialog', () => ({
  AlertDialog: ({ open, children }: { open: boolean; children: React.ReactNode }) =>
    open ? <div data-testid="delete-confirm-dialog">{children}</div> : null,
  AlertDialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
  AlertDialogDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
  AlertDialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDialogAction: ({
    children,
    onClick,
  }: {
    children: React.ReactNode;
    onClick?: () => void;
  }) => <button onClick={onClick}>{children}</button>,
  AlertDialogCancel: ({ children }: { children: React.ReactNode }) => <button>{children}</button>,
}));

function makeBacklogItem(status: BacklogItem['status']): BacklogItem {
  return {
    _id: 'bl-1' as Id<'chatroom_backlog'>,
    chatroomId: 'room-1' as Id<'chatroom_rooms'>,
    createdBy: 'user',
    content: 'Test backlog item',
    status,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

describe('BacklogItemDetailModal editor initialization', () => {
  it('opens in view mode for backlog status (no Save on open)', () => {
    render(<BacklogItemDetailModal isOpen item={makeBacklogItem('backlog')} onClose={vi.fn()} />);

    expect(screen.queryByTestId('backlog-rich-text-editor')).not.toBeInTheDocument();
    expect(screen.queryByText('Save')).not.toBeInTheDocument();
  });

  it('clicking content enters edit mode for backlog status', () => {
    render(<BacklogItemDetailModal isOpen item={makeBacklogItem('backlog')} onClose={vi.fn()} />);

    fireEvent.click(screen.getByText('Test backlog item'));

    expect(screen.getByTestId('backlog-rich-text-editor')).toBeInTheDocument();
    expect(screen.getByText('Save')).toBeInTheDocument();
    expect(screen.getByText('Cancel')).toBeInTheDocument();
  });

  it('clicking empty area below short content enters edit mode', () => {
    render(<BacklogItemDetailModal isOpen item={makeBacklogItem('backlog')} onClose={vi.fn()} />);

    const viewBody = screen.getByTestId('backlog-detail-view-body');
    // Click the container itself (below markdown text — simulates empty area)
    fireEvent.click(viewBody);

    expect(screen.getByTestId('backlog-rich-text-editor')).toBeInTheDocument();
  });

  it('cancel resets the draft to the original content', () => {
    render(<BacklogItemDetailModal isOpen item={makeBacklogItem('backlog')} onClose={vi.fn()} />);

    fireEvent.click(screen.getByText('Test backlog item'));
    const editor = screen.getByTestId('backlog-rich-text-editor') as HTMLTextAreaElement;
    fireEvent.change(editor, { target: { value: 'changed draft' } });
    expect(editor.value).toBe('changed draft');

    fireEvent.click(screen.getByText('Cancel'));

    fireEvent.click(screen.getByText('Test backlog item'));
    expect((screen.getByTestId('backlog-rich-text-editor') as HTMLTextAreaElement).value).toBe(
      'Test backlog item'
    );
  });

  it('shows Edit in Actions menu for backlog status', () => {
    render(<BacklogItemDetailModal isOpen item={makeBacklogItem('backlog')} onClose={vi.fn()} />);

    fireEvent.click(screen.getByText('Actions'));
    fireEvent.click(screen.getByText('Edit'));
    expect(screen.getByTestId('backlog-rich-text-editor')).toBeInTheDocument();
  });

  it('does not show Edit in Actions menu for pending_user_review status', () => {
    render(<BacklogItemDetailModal isOpen item={makeBacklogItem('pending_user_review')} onClose={vi.fn()} />);
    fireEvent.click(screen.getByText('Actions'));
    expect(screen.queryByText('Edit')).not.toBeInTheDocument();
  });

  it('opens in view mode for pending_user_review status', () => {
    render(
      <BacklogItemDetailModal
        isOpen
        item={makeBacklogItem('pending_user_review')}
        onClose={vi.fn()}
      />
    );

    expect(screen.queryByTestId('backlog-rich-text-editor')).not.toBeInTheDocument();
    expect(screen.queryByText('Save')).not.toBeInTheDocument();
    expect(screen.getByText('Mark Complete')).toBeInTheDocument();
  });

  it('opens in view mode for closed status', () => {
    render(<BacklogItemDetailModal isOpen item={makeBacklogItem('closed')} onClose={vi.fn()} />);

    expect(screen.queryByTestId('backlog-rich-text-editor')).not.toBeInTheDocument();
    expect(screen.queryByText('Save')).not.toBeInTheDocument();
    expect(screen.getByText('Reopen')).toBeInTheDocument();
  });
});

describe('BacklogItemDetailModal delete action', () => {
  beforeEach(() => {
    mockDeleteBacklogItem.mockReset();
    mockDeleteBacklogItem.mockResolvedValue({ success: true });
  });

  it('confirms then calls deleteBacklogItem for a closed item', async () => {
    const onClose = vi.fn();
    const item = makeBacklogItem('closed');
    render(<BacklogItemDetailModal isOpen item={item} onClose={onClose} />);

    fireEvent.click(screen.getByText('Actions'));
    fireEvent.click(screen.getByText('Delete'));

    const dialog = screen.getByTestId('delete-confirm-dialog');
    expect(within(dialog).getByText('Delete backlog item?')).toBeInTheDocument();
    expect(within(dialog).getByText('This cannot be undone.')).toBeInTheDocument();

    fireEvent.click(within(dialog).getByText('Delete'));

    await waitFor(() => {
      expect(mockDeleteBacklogItem).toHaveBeenCalledWith({
        chatroomId: item.chatroomId,
        itemId: item._id,
      });
      expect(onClose).toHaveBeenCalled();
    });
  });

  it('shows Delete for pending_user_review items', () => {
    const item = makeBacklogItem('pending_user_review');
    const { unmount } = render(<BacklogItemDetailModal isOpen item={item} onClose={vi.fn()} />);

    fireEvent.click(screen.getByText('Actions'));
    expect(screen.getAllByText('Delete').length).toBeGreaterThan(0);
    unmount();
  });

  it('shows Delete for closed items', () => {
    const item = makeBacklogItem('closed');
    render(<BacklogItemDetailModal isOpen item={item} onClose={vi.fn()} />);

    fireEvent.click(screen.getByText('Actions'));
    expect(screen.getAllByText('Delete').length).toBeGreaterThan(0);
  });
});
