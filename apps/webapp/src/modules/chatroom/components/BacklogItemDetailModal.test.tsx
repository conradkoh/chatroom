/**
 * BacklogItemDetailModal — status-based editor initialization.
 *
 * Backlog-status items open directly in the WYSIWYG editor; other statuses
 * open in read-only markdown view.
 */

import { render, screen } from '@testing-library/react';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { describe, expect, it, vi } from 'vitest';

import type { BacklogItem } from './backlog';
import { BacklogItemDetailModal } from './BacklogItemDetailModal';

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
  useSessionMutation: () => vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@workspace/backend/convex/_generated/api', () => ({
  api: {
    backlog: {
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

function makeBacklogItem(status: BacklogItem['status']): BacklogItem {
  return {
    _id: 'bl-1' as Id<'chatroom_backlog'>,
    chatroomId: 'room-1' as Id<'chatroom_rooms'>,
    createdBy: 'user',
    content: '**Ship** WYSIWYG on open',
    status,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

describe('BacklogItemDetailModal editor initialization', () => {
  it('opens in editor mode immediately for backlog status', () => {
    render(<BacklogItemDetailModal isOpen item={makeBacklogItem('backlog')} onClose={vi.fn()} />);

    expect(screen.getByTestId('backlog-rich-text-editor')).toBeInTheDocument();
    expect(screen.getByText('Save')).toBeInTheDocument();
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
