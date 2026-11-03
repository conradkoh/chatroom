'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { useSessionMutation, useSessionQuery } from 'convex-helpers/react/sessions';
import { CalendarClock } from 'lucide-react';
import { useEffect, useState } from 'react';

import { ScheduledPromptDetailDialog } from './ScheduledPromptDetailDialog';
import { ScheduledPromptsDialog } from './ScheduledPromptsDialog';
import { ScheduledPromptSidebarRow } from './ScheduledPromptSidebarRow';
import { SIDEBAR_PREVIEW_LIMIT, SidebarSection } from '../../../components/sidebar/SidebarSection';
import { useTwoTapConfirm } from '../../../hooks/useTwoTapConfirm';

export interface ScheduledPromptsSidebarSectionProps {
  chatroomId: Id<'chatroom_rooms'>;
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
  const [detailId, setDetailId] = useState<Id<'chatroom_scheduledPrompts'> | null>(null);
  const [manageOpen, setManageOpen] = useState(false);
  const remove = useSessionMutation(api.scheduledPrompts.remove);

  const { armedKey, request: requestDelete } = useTwoTapConfirm<Id<'chatroom_scheduledPrompts'>>(
    async (id) => {
      await remove({ scheduledPromptId: id });
    }
  );

  // A detail dialog must not outlive its row (deleted or fired).
  useEffect(() => {
    if (detailId && rows && !rows.some((row) => row._id === detailId)) {
      setDetailId(null);
    }
  }, [rows, detailId]);

  if (rows === undefined || rows.length === 0) return null;

  return (
    <div data-testid="scheduled-prompts-sidebar-section">
      <SidebarSection.Root
        title="Scheduled"
        count={rows.length}
        icon={CalendarClock}
        iconClassName="text-chatroom-status-info"
        viewMoreCount={Math.max(0, rows.length - SIDEBAR_PREVIEW_LIMIT)}
        onViewMore={() => setManageOpen(true)}
      >
        {rows.slice(0, SIDEBAR_PREVIEW_LIMIT).map((row) => (
          <ScheduledPromptSidebarRow
            key={row._id}
            prompt={row}
            deleteArmed={armedKey === row._id}
            onRequestDelete={requestDelete}
            onOpen={() => setDetailId(row._id)}
          />
        ))}
      </SidebarSection.Root>

      {detailId && (
        <ScheduledPromptDetailDialog
          open
          onOpenChange={(open) => {
            if (!open) setDetailId(null);
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
