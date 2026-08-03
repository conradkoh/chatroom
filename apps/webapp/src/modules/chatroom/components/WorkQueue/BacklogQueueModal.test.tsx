/**
 * BacklogQueueModal — stacked modal escape behavior
 *
 * Mirrors WorkQueue: list modal open → item detail opens on top → Escape closes only detail.
 */

import { fireEvent, render, screen } from '@testing-library/react';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import React, { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { BacklogItem } from '../backlog';
import { BacklogItemDetailModal } from '../BacklogItemDetailModal';
import { BacklogQueueModal } from './BacklogQueueModal';

import { resetOverlayDismissStackForTests } from '@/modules/chatroom/components/shared/overlayDismissStack';

vi.mock('next/dynamic', () => ({
  default: () => {
    const MockComponent = (props: Record<string, unknown>) => {
      const { value, onChange, onCmdEnter, ...rest } = props as {
        value: string;
        onChange: (md: string) => void;
        onCmdEnter?: () => void;
      };
      return (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
              onCmdEnter?.();
            }
          }}
          {...rest}
        />
      );
    };
    MockComponent.displayName = 'MockDynamicComponent';
    return MockComponent;
  },
}));

vi.mock('convex-helpers/react/sessions', () => ({
  useSessionMutation: () => vi.fn().mockResolvedValue(undefined),
  useSessionQuery: () => undefined,
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

vi.mock('../../attachments', () => ({
  useAttachments: () => ({
    add: vi.fn(),
    isAttached: () => false,
  }),
}));

vi.mock('../ui/dropdown-menu', () => ({
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

function makeBacklogItem(overrides: Partial<BacklogItem> = {}): BacklogItem {
  return {
    _id: 'bl-1' as Id<'chatroom_backlog'>,
    chatroomId: 'room-1' as Id<'chatroom_rooms'>,
    createdBy: 'user',
    content: 'Ship stacked modal escape fix',
    status: 'backlog',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

/** Matches WorkQueue render order: queue modal first, detail modal second. */
function StackedBacklogModals({
  initialDetailOpen = true,
  item = makeBacklogItem(),
}: {
  initialDetailOpen?: boolean;
  item?: BacklogItem;
}) {
  const [listOpen, setListOpen] = useState(true);
  const [detailOpen, setDetailOpen] = useState(initialDetailOpen);

  return (
    <>
      {listOpen && (
        <BacklogQueueModal
          items={[item]}
          onClose={() => setListOpen(false)}
          onItemClick={() => setDetailOpen(true)}
        />
      )}
      {detailOpen && (
        <BacklogItemDetailModal isOpen item={item} onClose={() => setDetailOpen(false)} />
      )}
    </>
  );
}

describe('BacklogQueueModal stacked escape', () => {
  beforeEach(() => {
    document.body.style.overflow = '';
  });

  afterEach(() => {
    resetOverlayDismissStackForTests();
    document.body.style.overflow = '';
  });

  it('closes only the detail modal on escape when detail is open over the list', () => {
    // Non-backlog items open in view mode, so Escape closes the detail directly.
    render(<StackedBacklogModals item={makeBacklogItem({ status: 'pending_user_review' })} />);

    expect(screen.getByText(/Backlog \(1 items\)/)).toBeInTheDocument();
    expect(screen.getByText('Backlog Item')).toBeInTheDocument();

    fireEvent.keyDown(window, { key: 'Escape' });

    expect(screen.getByText(/Backlog \(1 items\)/)).toBeInTheDocument();
    expect(screen.queryByText('Backlog Item')).not.toBeInTheDocument();
  });

  it('closes only the list modal when detail is not open', () => {
    render(<StackedBacklogModals initialDetailOpen={false} />);

    expect(screen.getByText(/Backlog \(1 items\)/)).toBeInTheDocument();
    expect(screen.queryByText('Backlog Item')).not.toBeInTheDocument();

    fireEvent.keyDown(window, { key: 'Escape' });

    expect(screen.queryByText(/Backlog \(1 items\)/)).not.toBeInTheDocument();
  });

  it('cancels edit mode on escape without closing either modal', () => {
    // Backlog items open directly in edit mode — no Edit click needed.
    render(<StackedBacklogModals />);
    expect(screen.getByText('Save')).toBeInTheDocument();

    fireEvent.keyDown(window, { key: 'Escape' });

    expect(screen.getByText(/Backlog \(1 items\)/)).toBeInTheDocument();
    expect(screen.getByText('Backlog Item')).toBeInTheDocument();
    expect(screen.queryByText('Save')).not.toBeInTheDocument();
  });
});
