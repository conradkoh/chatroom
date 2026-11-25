'use client';

import { useState, useSyncExternalStore } from 'react';

import { AttachmentsProvider } from '@/modules/chatroom/attachments';
import {
  TIMELINE_SCROLL_CONTAINER,
  TIMELINE_SCROLL_CONTAINER_STYLE,
} from '@/modules/chatroom/components/timeline/timelineRowStyles';
import { TimelineTeamMessage } from '@/modules/chatroom/components/timeline/TimelineTeamMessage';
import { isEagerTimelineEvent } from '@/modules/chatroom/timeline/isEagerTimelineEvent';
import { mapMessageToTimelineEvent } from '@/modules/chatroom/timeline/mapMessageToTimelineEvent';
import type { Message } from '@/modules/chatroom/types/message';

// The e2e spec pins the browser timezone to UTC; noon keeps the date stable there.
const CREATION_TIME = Date.UTC(2023, 10, 15, 12, 14, 22);

/** Use the production predicate so the fixtures cannot drift from the feed's behaviour. */
function isCollapsible(message: Message): boolean {
  return !isEagerTimelineEvent(mapMessageToTimelineEvent(message));
}

const NORMAL: Message = {
  _id: 'e2e-collapse-normal',
  type: 'handoff',
  senderRole: 'builder',
  targetRole: 'planner',
  content:
    'Implemented the summary bar and verified the focus behaviour. ' +
    'The collapsed row now shows a two-line preview instead of the full body.\n\n' +
    'Deferred body paragraph that must not render while the row is collapsed. ' +
    'It exists to prove the markdown body stays unmounted until the dialog opens.',
  _creationTime: CREATION_TIME,
};

/** Same handoff with one attached task: the attachment chips indent must line up with the preview text. */
const CHIPS: Message = {
  ...NORMAL,
  _id: 'e2e-collapse-chips',
  attachedTasks: [
    { _id: 'e2e-attached-task', content: 'Attached task for the chips indent fixture' },
  ],
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

/** Same long preview with a 1h 5m generation gap: the mobile bar must keep it on one line. */
const LONG_DURATION: Message = {
  _id: 'e2e-collapse-long-duration',
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

/** Exactly 64 characters: the longest harness segment the normalizer keeps without an ellipsis. */
const LONG_HARNESS = 'harness-'.repeat(8);
const LONG_HARNESS_AGENT = { harness: LONG_HARNESS, model: 'claude-sonnet-5-5-long-model-name' };

/** 100h 10m: the first 8-character duration. */
const HUGE_DURATION_MS = 100 * 3_600_000 + 10 * 60_000;

const COLLAPSE_LONG_HARNESS: Message = {
  ...NORMAL,
  _id: 'e2e-collapse-long-harness',
  senderAgent: LONG_HARNESS_AGENT,
};

const EAGER_LONG_HARNESS: Message = {
  ...EAGER,
  _id: 'e2e-eager-long-harness',
  senderAgent: LONG_HARNESS_AGENT,
};

/** Feed-stability fixture: a collapsible handoff and the row below it, inside a real inner scroller. */
const FEED_ROW: Message = {
  ...NORMAL,
  _id: 'e2e-collapse-feed-row',
};

const FEED_BELOW: Message = {
  ...EMPTY,
  _id: 'e2e-collapse-feed-below',
};

/** Tall body (>150 lines), a fenced code block, and a wide table that must scroll inside the prose container. */
const TALL_CONTENT = [
  '# Tall handoff',
  ...Array.from(
    { length: 120 },
    (_, index) => `Paragraph ${index + 1} keeps the dialog body scrolling.`
  ),
  '```ts\nconst answer = 42;\nconsole.log(answer);\n```',
  '| one | two | three | four | five | six | seven | eight | nine | ten |\n' +
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |\n' +
    '| 1111111111 | 2222222222 | 3333333333 | 4444444444 | 5555555555 | 6666666666 | 7777777777 | 8888888888 | 9999999999 | 0000000000 |',
].join('\n\n');

const TALL: Message = {
  _id: 'e2e-collapse-tall',
  type: 'handoff',
  senderRole: 'builder',
  targetRole: 'planner',
  content: TALL_CONTENT,
  _creationTime: CREATION_TIME,
};

const PLAN_CONTENT = [
  '# Ship the plan row',
  '',
  '## Sources',
  '',
  '- src-1',
  '',
  '## Requirements',
  '',
  '- Ship it.',
  '',
  '## Constraints',
  '',
  '- None.',
  '',
  '## Phases',
  '',
  '- P1 — Schema',
  '- P2 — Render',
  '',
  '## Phase details',
  '',
  '### P1 — Schema',
  '',
  '#### Requirements',
  '',
  '- Add schema.',
  '',
  '#### Constraints',
  '',
  '- None.',
  '',
  '#### Acceptance criteria',
  '',
  '- Parses.',
  '',
  '### P2 — Render',
  '',
  '#### Requirements',
  '',
  '- Render.',
  '',
  '#### Constraints',
  '',
  '- None.',
  '',
  '#### Acceptance criteria',
  '',
  '- Renders.',
].join('\n');

const PLAN: Message = {
  _id: 'e2e-collapse-plan',
  type: 'plan',
  senderRole: 'specifier',
  content: PLAN_CONTENT,
  _creationTime: CREATION_TIME,
};

/** No external store to subscribe to; the store is only a hydration marker. */
const subscribeToNothing = () => () => {};

/**
 * False during SSR and the hydration render, true once React has taken over the page. Used as the
 * e2e readiness marker so specs can wait for attached click handlers, not just rendered markup.
 */
function useIsHydrated(): boolean {
  return useSyncExternalStore(
    subscribeToNothing,
    () => true,
    () => false
  );
}

/** Development-only fixture for browser verification of the collapsed handoff bar. */
export default function TimelineHandoffCollapseTestPage() {
  const [isDark, setIsDark] = useState(false);
  const isHydrated = useIsHydrated();

  const toggleTheme = () => {
    const next = !isDark;
    setIsDark(next);
    document.documentElement.classList.toggle('dark', next);
  };

  return (
    <AttachmentsProvider>
      <main
        className="p-4 space-y-4 max-w-3xl"
        data-testid="timeline-handoff-collapse-harness"
        data-ready={isHydrated ? 'true' : undefined}
      >
        <h1>Timeline handoff collapse</h1>
        <button type="button" data-testid="theme-dark-toggle" onClick={toggleTheme}>
          Toggle dark theme
        </button>

        <section data-testid="collapse-normal">
          <TimelineTeamMessage
            message={NORMAL}
            chatroomId="e2e-chatroom"
            handoffDurationMs={252_000}
            collapsible={isCollapsible(NORMAL)}
          />
        </section>

        <section data-testid="collapse-empty">
          <TimelineTeamMessage
            message={EMPTY}
            chatroomId="e2e-chatroom"
            collapsible={isCollapsible(EMPTY)}
          />
        </section>

        <section data-testid="collapse-code">
          <TimelineTeamMessage
            message={CODE_ONLY}
            chatroomId="e2e-chatroom"
            collapsible={isCollapsible(CODE_ONLY)}
          />
        </section>

        <section data-testid="collapse-long">
          <TimelineTeamMessage
            message={LONG}
            chatroomId="e2e-chatroom"
            collapsible={isCollapsible(LONG)}
          />
        </section>

        <section data-testid="collapse-long-duration">
          <TimelineTeamMessage
            message={LONG_DURATION}
            chatroomId="e2e-chatroom"
            handoffDurationMs={3_900_000}
            collapsible={isCollapsible(LONG_DURATION)}
          />
        </section>

        <section data-testid="collapse-huge-duration">
          <TimelineTeamMessage
            message={{ ...NORMAL, _id: 'e2e-collapse-huge-duration' }}
            chatroomId="e2e-chatroom"
            handoffDurationMs={HUGE_DURATION_MS}
            collapsible={isCollapsible(NORMAL)}
          />
        </section>

        <section data-testid="collapse-long-harness">
          <TimelineTeamMessage
            message={COLLAPSE_LONG_HARNESS}
            chatroomId="e2e-chatroom"
            handoffDurationMs={252_000}
            collapsible={isCollapsible(COLLAPSE_LONG_HARNESS)}
          />
        </section>

        <section data-testid="collapse-tall">
          <TimelineTeamMessage
            message={TALL}
            chatroomId="e2e-chatroom"
            collapsible={isCollapsible(TALL)}
          />
        </section>

        <section data-testid="collapse-plan">
          <TimelineTeamMessage
            message={PLAN}
            chatroomId="e2e-chatroom"
            collapsible={isCollapsible(PLAN)}
          />
        </section>

        <section data-testid="eager-control">
          <TimelineTeamMessage
            message={EAGER}
            chatroomId="e2e-chatroom"
            collapsible={isCollapsible(EAGER)}
          />
        </section>

        <section data-testid="eager-long-harness">
          <TimelineTeamMessage
            message={EAGER_LONG_HARNESS}
            chatroomId="e2e-chatroom"
            handoffDurationMs={62_000}
            collapsible={isCollapsible(EAGER_LONG_HARNESS)}
          />
        </section>

        <section data-testid="collapse-feed" className="flex h-80 flex-col">
          {/* Mirrors ConversationMessageList's feed scroller: bounded flex parent, then the scroller. */}
          <div
            data-testid="collapse-feed-scroller"
            className={`relative z-0 flex-1 ${TIMELINE_SCROLL_CONTAINER}`}
            style={TIMELINE_SCROLL_CONTAINER_STYLE}
          >
            <div aria-hidden="true" className="h-[480px]" />
            <div data-testid="collapse-feed-row">
              <TimelineTeamMessage
                message={FEED_ROW}
                chatroomId="e2e-chatroom"
                handoffDurationMs={252_000}
                collapsible={isCollapsible(FEED_ROW)}
              />
            </div>
            <div data-testid="collapse-feed-below">
              <TimelineTeamMessage
                message={FEED_BELOW}
                chatroomId="e2e-chatroom"
                collapsible={isCollapsible(FEED_BELOW)}
              />
            </div>
            <div aria-hidden="true" className="h-[480px]" />
          </div>
        </section>

        <section data-testid="collapse-chips">
          <TimelineTeamMessage
            message={CHIPS}
            chatroomId="e2e-chatroom"
            handoffDurationMs={252_000}
            collapsible={isCollapsible(CHIPS)}
          />
        </section>
      </main>
    </AttachmentsProvider>
  );
}
