'use client';

import { AttachmentsProvider } from '@/modules/chatroom/attachments';
import { TimelineTeamMessage } from '@/modules/chatroom/components/timeline/TimelineTeamMessage';
import type { Message } from '@/modules/chatroom/types/message';

const HANDOFF: Message = {
  _id: 'e2e-handoff',
  type: 'handoff',
  senderRole: 'builder',
  targetRole: 'planner',
  content: 'E2E handoff timing check',
  // Keep the fixture away from midnight so the browser's local timezone cannot change the day.
  _creationTime: Date.UTC(2023, 10, 15, 12, 14, 22),
};

const MESSAGE: Message = {
  _id: 'e2e-message',
  type: 'message',
  senderRole: 'user',
  content: 'E2E ordinary message check',
  _creationTime: 1_700_000_000_000,
};

/** Development-only fixture for browser verification of the timeline footer. */
export default function TimelineHandoffTimingTestPage() {
  return (
    <AttachmentsProvider>
      <main className="p-4 space-y-4">
        <h1>Timeline handoff timing</h1>
        <section data-testid="handoff-timing-fixture">
          <TimelineTeamMessage
            message={HANDOFF}
            chatroomId="e2e-chatroom"
            handoffDurationMs={62_000}
          />
        </section>
        <section data-testid="ordinary-message-fixture">
          <TimelineTeamMessage message={MESSAGE} chatroomId="e2e-chatroom" />
        </section>
      </main>
    </AttachmentsProvider>
  );
}
