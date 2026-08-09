import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import {
  TimelineScrollResizeProvider,
  bracketTimelineScrollResize,
  useRegisterTimelineScrollResize,
  useTimelineScrollResize,
  type TimelineScrollResizeApi,
} from './TimelineScrollResizeContext';

function RegisterProbe({ api }: { api: TimelineScrollResizeApi | null }) {
  useRegisterTimelineScrollResize(api);
  return null;
}

function ConsumeButton() {
  const api = useTimelineScrollResize();
  return (
    <button
      type="button"
      onClick={() => {
        bracketTimelineScrollResize(api, () => {});
      }}
    >
      bracket
    </button>
  );
}

describe('TimelineScrollResizeContext', () => {
  it('registers an API from a child and exposes it to consumers via bracket', async () => {
    const user = userEvent.setup();
    const begin = vi.fn();
    const end = vi.fn();

    render(
      <TimelineScrollResizeProvider>
        <RegisterProbe api={{ beginResize: begin, endResize: end }} />
        <ConsumeButton />
      </TimelineScrollResizeProvider>
    );

    await user.click(screen.getByRole('button', { name: 'bracket' }));
    expect(begin).toHaveBeenCalled();
    expect(end).toHaveBeenCalled();
  });

  it('bracketTimelineScrollResize is a safe no-op when no provider is present', async () => {
    const user = userEvent.setup();
    const begin = vi.fn();
    const end = vi.fn();

    render(
      <>
        <RegisterProbe api={{ beginResize: begin, endResize: end }} />
        <ConsumeButton />
      </>
    );

    await user.click(screen.getByRole('button', { name: 'bracket' }));
    expect(begin).not.toHaveBeenCalled();
    expect(end).not.toHaveBeenCalled();
  });

  it('bracketTimelineScrollResize calls begin before fn and end after (even on throw)', () => {
    const order: string[] = [];
    const api = {
      beginResize: () => order.push('begin'),
      endResize: () => order.push('end'),
    };

    bracketTimelineScrollResize(api, () => {
      order.push('fn');
    });

    expect(order).toEqual(['begin', 'fn', 'end']);

    expect(() =>
      bracketTimelineScrollResize(api, () => {
        throw new Error('boom');
      })
    ).toThrow('boom');
    expect(order).toEqual(['begin', 'fn', 'end', 'begin', 'end']);
  });

  it('bracketTimelineScrollResize is a safe no-op when api is null', () => {
    expect(() => bracketTimelineScrollResize(null, () => {})).not.toThrow();
  });

  it('renders the provider without a DOM node', () => {
    render(
      <TimelineScrollResizeProvider>
        <div data-testid="child">child</div>
      </TimelineScrollResizeProvider>
    );
    expect(screen.getByTestId('child')).toBeInTheDocument();
  });
});
