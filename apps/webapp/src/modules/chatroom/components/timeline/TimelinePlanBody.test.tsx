import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { parsePlan } from '@workspace/backend/src/domain/plan/parse-plan';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TimelineEventRow } from './TimelineEventRow';
import { AttachmentsProvider } from '../../attachments';
import { toMessage } from '../../hooks/chatroomMessageStore';
import { mapMessageToTimelineEvent } from '../../timeline/mapMessageToTimelineEvent';
import type { Message } from '../../types/message';

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

/** The backend golden fixture, read from disk so this suite cannot drift from it. */
const PLAN_FIXTURE = readFileSync(
  resolve(
    __dirname,
    '../../../../../../../services/backend/src/domain/plan/__fixtures__/plan-v1.md'
  ),
  'utf-8'
);

/** Build a valid plan with `count` phases (1..20). */
function planWithPhases(count: number): string {
  const list = Array.from({ length: count }, (_, index) => `- P${index + 1} — Phase ${index + 1}`);
  const details = Array.from({ length: count }, (_, index) => {
    const id = index + 1;
    return [
      `### P${id} — Phase ${id}`,
      '',
      '#### Requirements',
      '',
      `- Requirement ${id}.`,
      '',
      '#### Constraints',
      '',
      '- None.',
      '',
      '#### Acceptance criteria',
      '',
      `- Acceptance ${id}.`,
    ].join('\n');
  });
  return [
    '# Generated plan',
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
    ...list,
    '',
    '## Phase details',
    '',
    details.join('\n\n'),
  ].join('\n');
}

function planMessage(overrides: Partial<Message> = {}): Message {
  return {
    _id: 'plan-1',
    type: 'plan',
    senderRole: 'specifier',
    content: PLAN_FIXTURE,
    _creationTime: 1_000,
    ...overrides,
  };
}

function renderRow(message: Message) {
  return render(
    <TimelineEventRow event={mapMessageToTimelineEvent(message)} chatroomId="room-1" />,
    { wrapper: AttachmentsProvider }
  );
}

/** Plan bodies mount only inside the details dialog, so open it before inspecting the body. */
function openPlan(message: Message) {
  const view = renderRow(message);
  fireEvent.click(screen.getByTestId('timeline-plan-trigger'));
  const dialog = screen.getByRole('dialog', { name: 'Full plan from specifier' });
  return { ...view, dialog };
}

const scrollIntoViewMock = vi.fn();
const originalScrollIntoView = Element.prototype.scrollIntoView;
const originalMatchMedia = window.matchMedia;

beforeEach(() => {
  scrollIntoViewMock.mockClear();
  Element.prototype.scrollIntoView = scrollIntoViewMock;
});

afterEach(() => {
  Element.prototype.scrollIntoView = originalScrollIntoView;
  // Restore the polyfill: the reduced-motion case replaces it for the rest of the file otherwise.
  window.matchMedia = originalMatchMedia;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** Flush the pending clipboard promise without advancing timers. */
async function flushMicrotasks() {
  await act(async () => {});
}

describe('TimelinePlanBody through the feed row', () => {
  it('collapses by default', () => {
    renderRow(planMessage());

    const trigger = screen.getByTestId('timeline-plan-trigger');
    expect(within(trigger).getByTestId('timeline-plan-summary-title')).toHaveTextContent(
      'Add plan messages to the chatroom'
    );
    expect(within(trigger).getByText('3 phases')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByTestId('timeline-plan-body')).not.toBeInTheDocument();
    expect(screen.queryByTestId('timeline-plan-title')).not.toBeInTheDocument();
    expect(screen.queryByTestId('timeline-plan-phase-index')).not.toBeInTheDocument();
    expect(screen.queryByTestId('timeline-plan-id-copy')).not.toBeInTheDocument();
  });

  it('renders the fixture as a structured plan in the dialog', () => {
    expect(parsePlan(PLAN_FIXTURE).ok).toBe(true);

    const { dialog } = openPlan(planMessage({ supersedesPlanId: 'plan-old-id-1234' }));

    const root = screen.getByTestId('timeline-team-message');
    expect(root).toHaveAttribute('data-message-type', 'plan');
    expect(within(root).getByText('plan')).toBeInTheDocument();
    expect(screen.queryByTestId('timeline-handoff-trigger')).not.toBeInTheDocument();
    expect(screen.getByTestId('timeline-plan-trigger')).toBeInTheDocument();
    expect(dialog).toBeInTheDocument();
    expect(screen.getByTestId('timeline-plan-body')).toBeInTheDocument();

    // Header route renders the sender only (no target arrow).
    const route = screen.getByTestId('timeline-message-header-route');
    expect(within(route).getByText('specifier')).toBeInTheDocument();
    expect(route.querySelector('svg')).toBeNull();

    expect(screen.getByTestId('timeline-plan-title')).toHaveTextContent(
      'Add plan messages to the chatroom'
    );
    expect(screen.getByTestId('timeline-plan-id-copy')).toBeInTheDocument();
    expect(screen.getByTitle('plan-old-id-1234')).toHaveTextContent('plan-o…1234');
    expect(within(dialog).getByText('3 phases')).toBeInTheDocument();

    expect(document.querySelectorAll('[data-testid^="timeline-plan-phase-link-"]')).toHaveLength(3);
    expect(screen.getByTestId('timeline-plan-phase-P1')).toBeInTheDocument();
    expect(screen.getByTestId('timeline-plan-phase-P2')).toBeInTheDocument();
    expect(screen.getByTestId('timeline-plan-phase-P3')).toBeInTheDocument();
    expect(screen.getAllByTestId('timeline-plan-phase-index')).toHaveLength(1);

    // Remarks only render when present.
    expect(screen.getByText('Remarks')).toBeInTheDocument();
    expect(
      screen.getByText('The plan row renders title, phases, and per-phase details.')
    ).toBeInTheDocument();
  });

  it('shows the Supersedes chip for a raw feed row published with --supersedes', () => {
    const feedMessage = toMessage({
      _id: 'plan-new-1',
      type: 'plan',
      senderRole: 'specifier',
      content: PLAN_FIXTURE,
      _creationTime: 1_000,
      supersedesPlanId: 'plan-old-id-1234',
    });

    openPlan(feedMessage);

    expect(screen.getByTestId('timeline-plan-supersedes')).toBeInTheDocument();
    expect(screen.getByTitle('plan-old-id-1234')).toHaveTextContent('plan-o…1234');
  });

  it('orders header, then the phase index, then Requirements', () => {
    openPlan(planMessage());

    const title = screen.getByTestId('timeline-plan-title');
    const index = screen.getByTestId('timeline-plan-phase-index');
    const requirements = screen.getAllByText('Requirements')[0];
    expect(title.compareDocumentPosition(index) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(
      index.compareDocumentPosition(requirements) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });

  it('renders muted None for every empty list instead of the None. token', () => {
    const { dialog } = openPlan(planMessage());

    // Plan-level Constraints and every phase's Constraints are `None.` in the fixture.
    const none = within(dialog).getAllByText('None');
    expect(none).toHaveLength(3);
    for (const node of none) expect(node).toHaveClass('italic', 'text-chatroom-text-muted');
    expect(screen.queryByText('None.')).not.toBeInTheDocument();

    const p1 = screen.getByTestId('timeline-plan-phase-P1');
    expect(within(p1).getByText('None')).toBeInTheDocument();
  });

  it('resolves every index link and depends chip to an element id in the DOM', () => {
    const { dialog } = openPlan(planMessage());

    const links = dialog.querySelectorAll<HTMLAnchorElement>(
      '[data-testid^="timeline-plan-phase-link-"], [data-testid^="timeline-plan-depends-"]'
    );
    expect(links).toHaveLength(5);
    for (const link of links) {
      const id = link.getAttribute('href')?.slice(1) ?? '';
      expect(document.getElementById(id)).not.toBeNull();
    }
  });

  it('jumps to the phase heading on an index link click without touching the hash', () => {
    openPlan(planMessage());

    fireEvent.click(screen.getByTestId('timeline-plan-phase-link-P2'));

    expect(scrollIntoViewMock).toHaveBeenCalledWith({ block: 'start', behavior: 'smooth' });
    expect(document.activeElement).toBe(document.getElementById('plan-plan-1-P2') as HTMLElement);
    expect(window.location.hash).toBe('');
    expect(screen.getByRole('dialog', { name: 'Full plan from specifier' })).toBeInTheDocument();
  });

  it('jumps from a depends chip to the referenced phase', () => {
    openPlan(planMessage());

    fireEvent.click(screen.getByTestId('timeline-plan-depends-P2-P1'));

    expect(scrollIntoViewMock).toHaveBeenCalledWith({ block: 'start', behavior: 'smooth' });
    expect(document.activeElement).toBe(document.getElementById('plan-plan-1-P1') as HTMLElement);
    expect(window.location.hash).toBe('');
  });

  it('jumps instantly under prefers-reduced-motion', () => {
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: query.includes('prefers-reduced-motion'),
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })) as unknown as typeof window.matchMedia;
    openPlan(planMessage());

    fireEvent.click(screen.getByTestId('timeline-plan-phase-link-P1'));

    expect(scrollIntoViewMock).toHaveBeenCalledWith({ block: 'start', behavior: 'auto' });
  });

  it('scrolls the phase heading into the dialog body and focuses it', () => {
    openPlan(planMessage());

    fireEvent.click(screen.getByTestId('timeline-plan-phase-link-P2'));

    const target = document.getElementById('plan-plan-1-P2') as HTMLElement;
    expect(screen.getByTestId('timeline-handoff-dialog-body')).toContainElement(target);
    expect(scrollIntoViewMock).toHaveBeenCalledWith({ block: 'start', behavior: 'smooth' });
    expect(document.activeElement).toBe(target);
    expect(window.location.hash).toBe('');
  });

  it('goes back to the phase index', () => {
    openPlan(planMessage());

    fireEvent.click(screen.getAllByTestId('timeline-plan-back-to-phases')[0]);

    expect(document.activeElement).toBe(
      document.getElementById('plan-plan-1-phases') as HTMLElement
    );
    expect(window.location.hash).toBe('');
  });

  it('keeps every back-link in the keyboard tab order', () => {
    openPlan(planMessage());
    const links = screen.getAllByTestId('timeline-plan-back-to-phases');
    expect(links.length).toBeGreaterThan(1);
    for (const link of links) {
      expect(link).not.toHaveAttribute('tabindex');
      act(() => link.focus());
      expect(document.activeElement).toBe(link);
    }
  });

  describe('copy feedback', () => {
    let writeText: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      writeText = vi.fn().mockResolvedValue(undefined);
      Object.defineProperty(navigator, 'clipboard', {
        value: { writeText },
        configurable: true,
      });
    });

    it('copies the plan id and resets after 2000ms', async () => {
      openPlan(planMessage());
      vi.useFakeTimers();

      fireEvent.click(screen.getByTestId('timeline-plan-id-copy'));
      await flushMicrotasks();

      expect(writeText).toHaveBeenCalledWith('plan-1');
      expect(screen.getByTestId('timeline-plan-id-copy')).toHaveAttribute('data-copied', 'true');
      expect(screen.getByTestId('timeline-plan-id-copy')).toHaveTextContent('Copied');
      expect(screen.getByTestId('timeline-plan-id-copy')).toHaveAttribute(
        'aria-label',
        'Copy plan id'
      );

      act(() => {
        vi.advanceTimersByTime(2000);
      });
      expect(screen.getByTestId('timeline-plan-id-copy')).toHaveAttribute('data-copied', 'false');
      expect(screen.getByTestId('timeline-plan-id-copy')).toHaveTextContent('Plan ID');
    });

    it('copies the phase reference from the index and marks the detail button too', async () => {
      openPlan(planMessage());

      fireEvent.click(screen.getByTestId('timeline-plan-phase-copy-P2'));
      await flushMicrotasks();

      expect(writeText).toHaveBeenCalledWith('plan-1#P2');
      expect(screen.getByTestId('timeline-plan-phase-copy-P2')).toHaveAttribute(
        'aria-label',
        'Copy P2 reference'
      );
      expect(screen.getByTestId('timeline-plan-phase-detail-copy-P2')).toHaveAttribute(
        'aria-label',
        'Copy P2 reference'
      );
      expect(screen.getByTestId('timeline-plan-phase-copy-P1')).toHaveAttribute(
        'aria-label',
        'Copy P1 reference'
      );
    });

    it('copies the superseded plan id', async () => {
      openPlan(planMessage({ supersedesPlanId: 'plan-old-id-1234' }));

      fireEvent.click(screen.getByTestId('timeline-plan-supersedes'));
      await flushMicrotasks();

      expect(writeText).toHaveBeenCalledWith('plan-old-id-1234');
    });

    it('shows an inline failure until the next copy attempt', async () => {
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
      writeText.mockRejectedValueOnce(new Error('denied'));
      openPlan(planMessage());

      fireEvent.click(screen.getByTestId('timeline-plan-id-copy'));
      await flushMicrotasks();

      expect(consoleError).toHaveBeenCalled();
      const failures = screen.getAllByText('Copy failed');
      expect(failures).toHaveLength(2);
      expect(failures.some((node) => node.classList.contains('text-chatroom-status-error'))).toBe(
        true
      );

      fireEvent.click(screen.getByTestId('timeline-plan-id-copy'));
      await flushMicrotasks();

      expect(screen.queryByText('Copy failed')).not.toBeInTheDocument();
      expect(screen.getByTestId('timeline-plan-id-copy')).toHaveAttribute('data-copied', 'true');
    });

    it('renders one polite live region per plan body and it is empty before a copy', () => {
      openPlan(planMessage());
      const status = screen.getByRole('status');
      expect(screen.getAllByRole('status')).toHaveLength(1);
      expect(status).toHaveAttribute('aria-live', 'polite');
      expect(status).toHaveTextContent(/^$/);
    });

    it('announces a successful copy through the live region', async () => {
      openPlan(planMessage());
      fireEvent.click(screen.getByTestId('timeline-plan-id-copy'));
      await flushMicrotasks();
      expect(screen.getByRole('status')).toHaveTextContent(/^Copied$/);
    });

    it('announces a failed copy through the live region', async () => {
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
      writeText.mockRejectedValueOnce(new Error('denied'));
      openPlan(planMessage());
      fireEvent.click(screen.getByTestId('timeline-plan-id-copy'));
      await flushMicrotasks();
      expect(consoleError).toHaveBeenCalled();
      expect(screen.getByRole('status')).toHaveTextContent(/^Copy failed$/);
    });
  });

  it('shows the plan id control and a muted notice for blank content', () => {
    openPlan(planMessage({ content: '   \n\n  ' }));

    expect(screen.getByTestId('timeline-plan-id-copy')).toBeInTheDocument();
    expect(screen.getByText('No plan content.')).toBeInTheDocument();
    expect(screen.queryByTestId('timeline-plan-body')).toBeInTheDocument();
  });

  it('falls back to raw markdown for content that does not match the template', () => {
    openPlan(planMessage({ content: 'Just some prose, not a plan.' }));

    const fallback = screen.getByTestId('timeline-plan-fallback');
    expect(
      within(fallback).getByText('Plan did not match the template. Showing raw markdown.')
    ).toBeInTheDocument();
    expect(within(fallback).getByText('Just some prose, not a plan.')).toBeInTheDocument();
    expect(screen.getByTestId('timeline-plan-id-copy')).toBeInTheDocument();
    expect(screen.queryByTestId('timeline-plan-phase-index')).not.toBeInTheDocument();
  });

  it('renders a one-phase plan without a back link', () => {
    expect(parsePlan(planWithPhases(1)).ok).toBe(true);
    const { dialog } = openPlan(planMessage({ content: planWithPhases(1) }));

    expect(within(dialog).getByText('1 phase')).toBeInTheDocument();
    expect(within(dialog).getByText('Phases · 1')).toBeInTheDocument();
    expect(screen.queryByTestId('timeline-plan-back-to-phases')).not.toBeInTheDocument();
    expect(document.querySelectorAll('[data-testid^="timeline-plan-phase-link-"]')).toHaveLength(1);
  });

  it('renders a 20-phase plan with 20 index entries and 20 detail blocks', () => {
    expect(parsePlan(planWithPhases(20)).ok).toBe(true);
    const { dialog } = openPlan(planMessage({ content: planWithPhases(20) }));

    expect(within(dialog).getByText('20 phases')).toBeInTheDocument();
    expect(document.querySelectorAll('[data-testid^="timeline-plan-phase-link-"]')).toHaveLength(
      20
    );
    expect(document.querySelectorAll('[data-testid^="timeline-plan-phase-P"]')).toHaveLength(20);
    expect(screen.getByTestId('timeline-plan-trigger')).toBeInTheDocument();

    const list = screen.getByTestId('timeline-plan-phase-index').querySelector('ol');
    expect(list?.className).toContain('@xl:columns-2');
  });

  it('keeps the index single column below eight phases', () => {
    openPlan(planMessage());

    const list = screen.getByTestId('timeline-plan-phase-index').querySelector('ol');
    expect(list?.className).not.toContain('@xl:columns-2');
  });

  it('uses container queries and only chatroom colour tokens', () => {
    const { dialog } = openPlan(planMessage());

    const body = within(dialog).getByTestId('timeline-plan-body');
    expect(body.className).toContain('@container');

    const hardCodedColour =
      /\b(?:bg|text|border|ring(?:-offset)?|fill|stroke|from|via|to|shadow|outline|decoration)-(?!chatroom-)(?:[a-z]+-\d{2,3}(?:\/\d+)?|white|black|transparent)\b|#[0-9a-fA-F]{3,8}\b|\brgba?\(|\b(?:oklch|hsl)\(/;
    const classes = Array.from(body.querySelectorAll<HTMLElement>('[data-testid^="timeline-plan"]'))
      .flatMap((node) => Array.from(node.classList))
      .join(' ');
    expect(classes).not.toBe('');
    expect(classes).not.toMatch(hardCodedColour);

    // The collapsed bar stays on the same tokens as the body.
    const bar = screen.getByTestId('timeline-plan-trigger');
    const barClasses = [
      bar,
      ...bar.querySelectorAll<HTMLElement>('[data-testid^="timeline-plan-summary"]'),
    ]
      .flatMap((node) => Array.from(node.classList))
      .join(' ');
    expect(barClasses).not.toBe('');
    expect(barClasses).not.toMatch(hardCodedColour);
  });
});
