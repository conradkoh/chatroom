'use client';

/**
 * SkillsTab — Manage skill customizations for a chatroom.
 *
 * Customizable skills are registered in the backend skills registry. When none
 * support per-chatroom customization, this tab shows an empty state.
 */

import { memo } from 'react';

interface SkillsTabProps {
  chatroomId: string;
}

export const SkillsTab = memo(function SkillsTab(_props: SkillsTabProps) {
  return (
    <div className="space-y-6 p-4">
      <div>
        <h3 className="text-sm font-medium text-foreground">Skills</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          No customizable skills are available for this chatroom right now.
        </p>
      </div>
    </div>
  );
});
