'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import type { Doc, Id } from '@workspace/backend/convex/_generated/dataModel';
import { useSessionMutation, useSessionQuery } from 'convex-helpers/react/sessions';
import { CalendarClock } from 'lucide-react';
import { useState } from 'react';

import { ScheduledPromptDetailDialog } from './ScheduledPromptDetailDialog';
import { ScheduledPromptsDialog } from './ScheduledPromptsDialog';
import { ScheduledPromptSidebarRow } from './ScheduledPromptSidebarRow';
import { SIDEBAR_PREVIEW_LIMIT, SidebarSection } from '../../../components/sidebar/SidebarSection';

export interface ScheduledPromptsSidebarSectionProps {
  chatroomId: Id<'chatroom_rooms'>;
}

/** Mirrors the backend `listUpcoming` cap (`MAX_UPCOMING`). */
const UPCOMING_LIMIT = 20;

function rowExists(
  rows: Doc<'chatroom_scheduledPrompts'>[] | undefined,
  id: Id<'chatroom_scheduledPrompts'> | null
): boolean {
  if (id === null || !rows) return false;
  return rows.some((row) => row._id === id);
}

/**
 * Detail dialog state that cannot outlive its row. Adjusting during render is
 * deliberate: the Convex server is the source of truth, and rendering the
 * detail for a missing row would call `scheduledPrompts.get` (NOT_FOUND).
 */
function useRowDetail(rows: Doc<'chatroom_scheduledPrompts'>[] | undefined) {
  const [detailId, setDetailId] = useState<Id<'chatroom_scheduledPrompts'> | null>(null);
  const exists = rowExists(rows, detailId);
  if (detailId !== null && !exists) setDetailId(null);
  return {
    detailId: exists ? detailId : null,
    openDetail: setDetailId,
    closeDetail: () => setDetailId(null),
  };
}

/** Header label and View-more count for a (possibly capped) preview list. */
function previewLabels(rows: Doc<'chatroom_scheduledPrompts'>[]) {
  const capped = rows.length === UPCOMING_LIMIT;
  return {
    countLabel: capped ? `${rows.length}+` : undefined,
    viewMoreCount: Math.max(0, rows.length - SIDEBAR_PREVIEW_LIMIT),
  };
}

/**
 * Sidebar summary of the next scheduled prompts. Hidden entirely while loading
 * or when the chatroom has no runnable prompts, so the section never shows an
 * empty state.
 */
export function ScheduledPromptsSidebarSection({
  chatroomId,
}: ScheduledPromptsSidebarSectionProps) {
  const rows = useSessionQuery(api.scheduledPrompts.listUpcoming, { chatroomId });
  const { detailId, openDetail, closeDetail } = useRowDetail(rows);
  const [manageOpen, setManageOpen] = useState(false);
  const remove = useSessionMutation(api.scheduledPrompts.remove);

  if (rows === undefined || rows.length === 0) return null;

  const { countLabel, viewMoreCount } = previewLabels(rows);

  return (
    <div data-testid="scheduled-prompts-sidebar-section">
      <SidebarSection.Root
        title="Scheduled"
        count={rows.length}
        countLabel={countLabel}
        icon={CalendarClock}
        iconClassName="text-chatroom-status-info"
        viewMoreCount={viewMoreCount}
        onViewMore={() => setManageOpen(true)}
      >
        {rows.slice(0, SIDEBAR_PREVIEW_LIMIT).map((row) => (
          <ScheduledPromptSidebarRow
            key={row._id}
            prompt={row}
            onDelete={(id) => remove({ scheduledPromptId: id })}
            onOpen={() => openDetail(row._id)}
          />
        ))}
      </SidebarSection.Root>

      {detailId !== null && (
        <ScheduledPromptDetailDialog
          open
          onOpenChange={(open) => {
            if (!open) closeDetail();
          }}
          scheduledPromptId={detailId}
        />
      )}

      <ScheduledPromptsDialog
        open={manageOpen}
        onOpenChange={setManageOpen}
        chatroomId={chatroomId}
      />
    </div>
  );
}
