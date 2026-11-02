import { describe, it, expect } from 'vitest';

import {
  getTimelineVirtualRowZIndex,
  TIMELINE_HANDOFF_CHEVRON,
  TIMELINE_HANDOFF_PREVIEW_TEXT,
  TIMELINE_HANDOFF_TOGGLE,
  TIMELINE_HANDOFF_TOGGLE_LABEL,
  TIMELINE_MESSAGE_BODY,
  TIMELINE_MESSAGE_HEADER_STICKY,
  TIMELINE_ROW_ROOT,
  TIMELINE_SCROLL_CONTAINER,
  TIMELINE_SCROLL_CONTAINER_STYLE,
} from './timelineRowStyles';

describe('getTimelineVirtualRowZIndex', () => {
  it('returns 1-based index for virtual row stacking', () => {
    expect(getTimelineVirtualRowZIndex(0)).toBe(1);
    expect(getTimelineVirtualRowZIndex(5)).toBe(6);
  });
});

describe('timeline row stacking classes', () => {
  it('exports row isolation and body z-0 classes', () => {
    expect(TIMELINE_ROW_ROOT).toContain('isolate');
    expect(TIMELINE_MESSAGE_BODY).toContain('z-0');
  });
});

describe('TIMELINE_SCROLL_CONTAINER', () => {
  it('establishes flex scroll boundary with gutter and classic scrollbar', () => {
    expect(TIMELINE_SCROLL_CONTAINER).toContain('min-h-0');
    expect(TIMELINE_SCROLL_CONTAINER).toContain('[scrollbar-gutter:stable]');
    expect(TIMELINE_SCROLL_CONTAINER).toContain('[&::-webkit-scrollbar]:w-2');
  });
});

describe('TIMELINE_MESSAGE_HEADER_STICKY', () => {
  it('constrains width to content lane left of scrollbar', () => {
    expect(TIMELINE_MESSAGE_HEADER_STICKY).toContain(
      'w-[calc(100%-var(--timeline-scrollbar-width,0px))]'
    );
  });
});

describe('TIMELINE_SCROLL_CONTAINER_STYLE', () => {
  it('sets inherited scrollbar width variable', () => {
    expect(TIMELINE_SCROLL_CONTAINER_STYLE['--timeline-scrollbar-width']).toBe('8px');
  });
});

describe('TIMELINE_HANDOFF_TOGGLE', () => {
  it('is a full-width, interactive disclosure bar', () => {
    expect(TIMELINE_HANDOFF_TOGGLE).toContain('w-full');
    expect(TIMELINE_HANDOFF_TOGGLE).toContain('py-2');
    expect(TIMELINE_HANDOFF_TOGGLE).toContain('hover:bg-chatroom-bg-hover');
    expect(TIMELINE_HANDOFF_TOGGLE).toContain('active:opacity-80');
    expect(TIMELINE_HANDOFF_TOGGLE).toContain('focus-visible:ring-chatroom-accent');
  });
});

describe('TIMELINE_HANDOFF_CHEVRON', () => {
  it('aligns to the first text line and respects reduced motion', () => {
    expect(TIMELINE_HANDOFF_CHEVRON).toContain('mt-[3px]');
    expect(TIMELINE_HANDOFF_CHEVRON).toContain('motion-reduce:transition-none');
  });
});

describe('TIMELINE_HANDOFF_PREVIEW_TEXT', () => {
  it('clamps the preview to two wrapped lines', () => {
    expect(TIMELINE_HANDOFF_PREVIEW_TEXT).toContain('line-clamp-2');
    expect(TIMELINE_HANDOFF_PREVIEW_TEXT).toContain('leading-5');
    expect(TIMELINE_HANDOFF_PREVIEW_TEXT).toContain('[overflow-wrap:anywhere]');
  });
});

describe('TIMELINE_HANDOFF_TOGGLE_LABEL', () => {
  it('matches the 20px line height of the bar', () => {
    expect(TIMELINE_HANDOFF_TOGGLE_LABEL).toContain('leading-5');
  });
});
