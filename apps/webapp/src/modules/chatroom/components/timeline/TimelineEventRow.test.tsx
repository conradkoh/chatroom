/**
 * TimelineEventRow — delegates to the correct cell by event.kind.
 */
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type React from 'react';
import { describe, it, expect, vi } from 'vitest';

import { TimelineEventRow } from './TimelineEventRow';
import { TIMELINE_MESSAGE_HEADER_STICKY, TIMELINE_ROW_ROOT } from './timelineRowStyles';
import { AttachmentsProvider } from '../../attachments';
import { toMessage } from '../../hooks/chatroomMessageStore';
import { mapMessageToTimelineEvent } from '../../timeline/mapMessageToTimelineEvent';
import type { Message } from '../../types/message';

// matchMedia polyfill needed by useIsDesktop (used by MessageDownloadMenu)
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

function renderRow(ui: React.ReactElement) {
  return render(<AttachmentsProvider>{ui}</AttachmentsProvider>);
}

function makeMessage(overrides: Partial<Message> = {}): Message {
  return {
    _id: 'msg-1',
    type: 'message',
    senderRole: 'user',
    content: 'Hello timeline',
    _creationTime: 1_000,
    ...overrides,
  };
}

const TEST_CHATROOM_ID = 'jn7fmvz7sd76z5wwgj1m7ty6vd7z81x2';

// Ampersand built from a char code: keeps this file free of a literal out-of-range entity.
const AMP = String.fromCharCode(38);

const STATUS_LABELS = ['pending', 'acknowledged', 'in progress', 'done', 'cancelled', 'backlog'];

/** A valid two-phase plan, built with the same shape the parser accepts in the other plan suites. */
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

describe('TimelineEventRow', () => {
  it('renders user message cell', () => {
    const event = mapMessageToTimelineEvent(makeMessage());
    renderRow(<TimelineEventRow event={event} chatroomId={TEST_CHATROOM_ID} />);
    expect(screen.getByTestId('timeline-user-message')).toBeInTheDocument();
    expect(screen.getByTestId('timeline-message-header')).toHaveClass(
      ...TIMELINE_MESSAGE_HEADER_STICKY.split(' ')
    );
    expect(screen.getByText('Hello timeline')).toBeInTheDocument();
    expect(screen.getByTestId('timeline-message-footer')).toBeInTheDocument();
  });

  it('renders user → target route header from a backend payload', () => {
    // Backend-shaped payload as received over the wire (no task-status field).
    const message = toMessage({
      _id: 'msg-route-1',
      type: 'message',
      senderRole: 'user',
      targetRole: 'planner',
      content: 'Route body',
      _creationTime: 2_000,
    });
    const event = mapMessageToTimelineEvent(message);
    renderRow(<TimelineEventRow event={event} chatroomId={TEST_CHATROOM_ID} />);

    const header = screen.getByTestId('timeline-message-header');
    expect(header).toHaveTextContent('user');
    expect(header).toHaveTextContent('planner');
    expect(screen.getByTestId('timeline-message-route')).toBeInTheDocument();

    for (const label of STATUS_LABELS) {
      expect(header).not.toHaveTextContent(label);
    }
  });

  it('renders context cell', () => {
    const event = mapMessageToTimelineEvent(
      makeMessage({ type: 'new-context', senderRole: 'system', content: 'Context body' })
    );
    render(<TimelineEventRow event={event} chatroomId={TEST_CHATROOM_ID} />);
    expect(screen.getByTestId('timeline-context')).toBeInTheDocument();
    expect(screen.getByText('New Context')).toBeInTheDocument();
  });

  it('renders team message cell', () => {
    // Agent-to-user rows stay eager, so the cell renders its body and footer.
    const event = mapMessageToTimelineEvent(
      makeMessage({ senderRole: 'builder', targetRole: 'user', content: 'Handoff note' })
    );
    renderRow(<TimelineEventRow event={event} chatroomId={TEST_CHATROOM_ID} />);
    expect(screen.getByTestId('timeline-team-message')).toBeInTheDocument();
    expect(screen.getByTestId('timeline-message-footer')).toBeInTheDocument();
    expect(screen.getByText('Handoff note')).toBeInTheDocument();
  });

  it('renders sticky message header on team handoff rows', () => {
    const event = mapMessageToTimelineEvent(
      makeMessage({ type: 'handoff', senderRole: 'planner', targetRole: 'user', content: 'Done' })
    );
    renderRow(<TimelineEventRow event={event} chatroomId={TEST_CHATROOM_ID} />);
    const header = screen.getByTestId('timeline-message-header');
    expect(header).toHaveClass(...TIMELINE_MESSAGE_HEADER_STICKY.split(' '));
    expect(header.className).not.toContain('-mx-4');
    expect(screen.getByText('planner')).toBeInTheDocument();
    expect(screen.getByText('user')).toBeInTheDocument();

    const row = screen.getByTestId('timeline-team-message');
    expect(row).toHaveClass(...TIMELINE_ROW_ROOT.split(' '));
  });

  it('routes agent-to-agent handoffs through the collapsed preview', () => {
    const event = mapMessageToTimelineEvent(
      makeMessage({
        type: 'handoff',
        senderRole: 'builder',
        targetRole: 'planner',
        content: 'Preview line.\n\nDeferred body line.',
      })
    );
    renderRow(<TimelineEventRow event={event} chatroomId={TEST_CHATROOM_ID} />);

    expect(screen.getByTestId('timeline-handoff-preview')).toHaveTextContent('Preview line.');
    expect(screen.queryByText('Deferred body line.')).not.toBeInTheDocument();
    expect(document.querySelector('.prose')).toBeNull();
  });

  it('keeps agent-to-user handoffs expanded', () => {
    const event = mapMessageToTimelineEvent(
      makeMessage({
        type: 'handoff',
        senderRole: 'builder',
        targetRole: 'user',
        content: 'Delivered body.',
      })
    );
    renderRow(<TimelineEventRow event={event} chatroomId={TEST_CHATROOM_ID} />);

    expect(screen.getByText('Delivered body.')).toBeInTheDocument();
    expect(screen.queryByTestId('timeline-handoff-preview')).not.toBeInTheDocument();
  });

  it('renders a handoff carrying an out-of-range numeric entity without the row fallback', () => {
    const event = mapMessageToTimelineEvent(
      makeMessage({
        type: 'handoff',
        senderRole: 'builder',
        targetRole: 'user',
        content: `Bad entity handoff ${AMP}#1114112; end`,
      })
    );
    renderRow(<TimelineEventRow event={event} chatroomId={TEST_CHATROOM_ID} />);

    expect(screen.getByTestId('timeline-team-message')).toBeInTheDocument();
    expect(screen.getByText(/Bad entity handoff/)).toBeInTheDocument();
    expect(screen.queryByTestId('timeline-row-error')).not.toBeInTheDocument();
  });
});

describe('TimelineEventRow plan rows', () => {
  const planEvent = () =>
    mapMessageToTimelineEvent(
      makeMessage({
        _id: 'plan-row-1',
        type: 'plan',
        senderRole: 'specifier',
        content: PLAN_CONTENT,
        _creationTime: 1_000,
      })
    );

  it('collapses a plan row to the summary bar with no body mounted', () => {
    renderRow(<TimelineEventRow event={planEvent()} chatroomId={TEST_CHATROOM_ID} />);

    const trigger = screen.getByTestId('timeline-plan-trigger');
    expect(within(trigger).getByTestId('timeline-plan-summary-title')).toHaveTextContent(
      'Ship the plan row'
    );
    expect(within(trigger).getByText('2 phases')).toBeInTheDocument();
    expect(screen.queryByTestId('timeline-plan-body')).not.toBeInTheDocument();
    expect(screen.queryByTestId('timeline-plan-title')).not.toBeInTheDocument();
    expect(screen.queryByTestId('timeline-plan-phase-index')).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('opens the full plan with Enter and closes with Escape, returning focus to the bar', async () => {
    const user = userEvent.setup();
    renderRow(<TimelineEventRow event={planEvent()} chatroomId={TEST_CHATROOM_ID} />);
    const trigger = screen.getByTestId('timeline-plan-trigger');

    trigger.focus();
    await user.keyboard('{Enter}');
    const dialog = screen.getByRole('dialog', { name: 'Full plan from specifier' });
    expect(within(dialog).getByTestId('timeline-plan-body')).toBeInTheDocument();
    expect(within(dialog).getByTestId('timeline-plan-title')).toHaveTextContent(
      'Ship the plan row'
    );

    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it('opens with a click and closes with the header close button, returning focus to the bar', async () => {
    const user = userEvent.setup();
    renderRow(<TimelineEventRow event={planEvent()} chatroomId={TEST_CHATROOM_ID} />);
    const trigger = screen.getByTestId('timeline-plan-trigger');

    await user.click(trigger);
    expect(screen.getByRole('dialog', { name: 'Full plan from specifier' })).toBeInTheDocument();

    await user.click(screen.getByTestId('timeline-handoff-dialog-close'));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });
});
