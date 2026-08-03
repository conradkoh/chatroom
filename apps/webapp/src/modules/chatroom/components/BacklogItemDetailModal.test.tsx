/**
 * BacklogItemDetailModal — Delete action with confirmation dialog.
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
      const { value, onChange, ...rest } = props as {
        value: string;
        onChange: (md: string) => void;
      };
      return (
        <textarea
          data-testid="backlog-rich-text-editor"
          value={value}
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

function makeBacklogItem(status: BacklogItem['status'] = 'backlog'): BacklogItem {
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

describe('BacklogItemDetailModal delete action', () => {
  beforeEach(() => {
    mockDeleteBacklogItem.mockReset();
    mockDeleteBacklogItem.mockResolvedValue({ success: true });
  });

  it('confirms then calls deleteBacklogItem for a backlog item', async () => {
    const onClose = vi.fn();
    const item = makeBacklogItem('backlog');
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
