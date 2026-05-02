'use client';

import { memo } from 'react';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';

interface DirectHarnessViewProps {
  chatroomId: Id<'chatroom_rooms'>;
}

export const DirectHarnessView = memo(function DirectHarnessView({
  chatroomId: _chatroomId,
}: DirectHarnessViewProps) {
  // c1: scaffold only — workspace switcher, session list, detail land in later iterations
  return (
    <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
      Select a workspace to view direct-harness sessions.
    </div>
  );
});
