'use client';

import { useState } from 'react';

import { AttachmentsProvider } from '@/modules/chatroom/attachments';
import { TimelineTeamMessage } from '@/modules/chatroom/components/timeline/TimelineTeamMessage';
import type { Message } from '@/modules/chatroom/types/message';

// Keep the fixtures away from midnight so the browser's local timezone cannot change the day.
const CREATION_TIME = Date.UTC(2023, 10, 15, 12, 14, 22);

const NORMAL: Message = {
  _id: 'e2e-collapse-normal',
  type: 'handoff',
  senderRole: 'builder',
  targetRole: 'planner',
  content:
    'Implemented the summary bar and verified the focus behaviour. ' +
    'The collapsed row now shows a two-line preview instead of the full body.\n\n' +
    'Deferred body paragraph that must not render while the row is collapsed. ' +
    'It exists to prove the markdown body stays unmounted until the row expands.',
  _creationTime: CREATION_TIME,
};

const EMPTY: Message = {
  _id: 'e2e-collapse-empty',
  type: 'handoff',
  senderRole: 'builder',
  targetRole: 'planner',
  content: '   \n\n  ',
  _creationTime: CREATION_TIME,
};

const CODE_ONLY: Message = {
  _id: 'e2e-collapse-code',
  type: 'handoff',
  senderRole: 'builder',
  targetRole: 'planner',
  content: '```ts\nconst a = 1;\n```',
  _creationTime: CREATION_TIME,
};

/** 600+ characters including one 120-character unbroken token. */
const LONG_CONTENT = `${'word '.repeat(90)}${'x'.repeat(120)} ${'tail '.repeat(10)}`.trim();

const LONG: Message = {
  _id: 'e2e-collapse-long',
  type: 'handoff',
  senderRole: 'builder',
  targetRole: 'planner',
  content: LONG_CONTENT,
  _creationTime: CREATION_TIME,
};

const EAGER: Message = {
  _id: 'e2e-eager-control',
  type: 'handoff',
  senderRole: 'builder',
  targetRole: 'user',
  content: 'Eager handoff to the user, which never collapses.',
  _creationTime: CREATION_TIME,
};

/** Development-only fixture for browser verification of the collapsed handoff bar. */
export default function TimelineHandoffCollapseTestPage() {
  const [isDark, setIsDark] = useState(false);

  const toggleTheme = () => {
    const next = !isDark;
    setIsDark(next);
    document.documentElement.classList.toggle('dark', next);
  };

  return (
    <AttachmentsProvider>
      <main className="p-4 space-y-4 max-w-3xl">
        <h1>Timeline handoff collapse</h1>
        <button type="button" data-testid="theme-dark-toggle" onClick={toggleTheme}>
          Toggle dark theme
        </button>

        <section data-testid="collapse-normal">
          <TimelineTeamMessage
            message={NORMAL}
            chatroomId="e2e-chatroom"
            handoffDurationMs={252_000}
            collapsible
          />
        </section>

        <section data-testid="collapse-empty">
          <TimelineTeamMessage message={EMPTY} chatroomId="e2e-chatroom" collapsible />
        </section>

        <section data-testid="collapse-code">
          <TimelineTeamMessage message={CODE_ONLY} chatroomId="e2e-chatroom" collapsible />
        </section>

        <section data-testid="collapse-long">
          <TimelineTeamMessage message={LONG} chatroomId="e2e-chatroom" collapsible />
        </section>

        <section data-testid="eager-control">
          <TimelineTeamMessage message={EAGER} chatroomId="e2e-chatroom" />
        </section>
      </main>
    </AttachmentsProvider>
  );
}
