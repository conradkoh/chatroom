import { describe, it, expect } from 'vitest';

import {
  getTimelineVirtualRowZIndex,
  TIMELINE_AGENT_DOT,
  TIMELINE_AGENT_HARNESS,
  TIMELINE_AGENT_LINE,
  TIMELINE_AGENT_MODEL,
  TIMELINE_AGENT_PLACEMENT,
  TIMELINE_BAR_META_PLAIN,
  TIMELINE_FOOTER_TIMESTAMP,
  TIMELINE_HANDOFF_CHIPS,
  TIMELINE_HANDOFF_DURATION_SLOT,
  TIMELINE_HANDOFF_FOOTER,
  TIMELINE_HANDOFF_FOOTER_AGENT_ROW,
  TIMELINE_HANDOFF_FOOTER_TIME_ROW,
  TIMELINE_HANDOFF_META,
  TIMELINE_HANDOFF_META_DURATION_SLOT,
  TIMELINE_HANDOFF_META_TIME_ROW,
  TIMELINE_HANDOFF_OPEN_ICON,
  TIMELINE_HANDOFF_PREVIEW_TEXT,
  TIMELINE_HANDOFF_TIMESTAMP,
  TIMELINE_HANDOFF_TRIGGER,
  TIMELINE_HANDOFF_TRIGGER_LABEL,
  TIMELINE_MESSAGE_BODY,
  TIMELINE_MESSAGE_HEADER_STICKY,
  TIMELINE_PLAN_CONTROL,
  TIMELINE_PLAN_LABEL,
  TIMELINE_ROW_ROOT,
  TIMELINE_SCROLL_CONTAINER,
  TIMELINE_SCROLL_CONTAINER_STYLE,
} from './timelineRowStyles';

/** Below-sm stacking classes as literals: the private stacked constant is not importable. */
const BELOW_SM_STACKING_CLASSES = [
  'max-sm:basis-full',
  'max-sm:max-w-full',
  'max-sm:pl-[1.375rem]',
  'max-sm:leading-4',
];

/** Any Tailwind palette colour utility that is not a chatroom token, or a raw colour literal. */
const HARD_CODED_COLOUR =
  /\b(?:bg|text|border|ring(?:-offset)?|fill|stroke|from|via|to|shadow|outline|decoration)-(?!chatroom-)(?:[a-z]+-\d{2,3}(?:\/\d+)?|white|black|transparent)\b|#[0-9a-fA-F]{3,8}\b|\brgba?\(|\b(?:oklch|hsl)\(/;

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

describe('TIMELINE_HANDOFF_TRIGGER', () => {
  it('is a full-width, interactive dialog trigger', () => {
    expect(TIMELINE_HANDOFF_TRIGGER).toContain('w-full');
    expect(TIMELINE_HANDOFF_TRIGGER).toContain('py-2');
    expect(TIMELINE_HANDOFF_TRIGGER).toContain('hover:bg-chatroom-bg-hover');
    expect(TIMELINE_HANDOFF_TRIGGER).toContain('active:opacity-80');
    expect(TIMELINE_HANDOFF_TRIGGER).toContain('focus-visible:ring-chatroom-accent');
    expect(TIMELINE_HANDOFF_TRIGGER).toContain('motion-reduce:transition-none');
  });

  it('wraps its children below sm so the meta drops to a second row', () => {
    expect(TIMELINE_HANDOFF_TRIGGER).toContain('max-sm:flex-wrap');
    expect(TIMELINE_HANDOFF_TRIGGER).toContain('max-sm:gap-y-1');
  });
});

describe('TIMELINE_HANDOFF_OPEN_ICON', () => {
  it('is a static icon: no rotation or transition classes', () => {
    expect(TIMELINE_HANDOFF_OPEN_ICON).toContain('mt-[3px]');
    expect(TIMELINE_HANDOFF_OPEN_ICON).not.toContain('transition-transform');
    expect(TIMELINE_HANDOFF_OPEN_ICON).not.toContain('rotate');
    expect(TIMELINE_HANDOFF_OPEN_ICON).not.toContain('duration-');
  });
});

describe('TIMELINE_HANDOFF_PREVIEW_TEXT', () => {
  it('clamps the preview to two wrapped lines', () => {
    expect(TIMELINE_HANDOFF_PREVIEW_TEXT).toContain('line-clamp-2');
    expect(TIMELINE_HANDOFF_PREVIEW_TEXT).toContain('leading-5');
    expect(TIMELINE_HANDOFF_PREVIEW_TEXT).toContain('[overflow-wrap:anywhere]');
  });
});

describe('TIMELINE_HANDOFF_TRIGGER_LABEL', () => {
  it('matches the 20px line height of the bar', () => {
    expect(TIMELINE_HANDOFF_TRIGGER_LABEL).toContain('leading-5');
  });
});

describe('TIMELINE_HANDOFF_CHIPS', () => {
  it('indents chips to the preview text', () => {
    expect(TIMELINE_HANDOFF_CHIPS).toBe('pl-[2.375rem]');
    expect(TIMELINE_HANDOFF_CHIPS).toContain('pl-[2.375rem]');
  });
});

describe('TIMELINE_HANDOFF_META', () => {
  it('is a right-anchored two-line column that takes at most 55% of the bar', () => {
    expect(TIMELINE_HANDOFF_META).toContain('flex-col');
    expect(TIMELINE_HANDOFF_META).toContain('items-end');
    expect(TIMELINE_HANDOFF_META).toContain('max-w-[55%]');
    expect(TIMELINE_HANDOFF_META).toContain('shrink-0');
    expect(TIMELINE_HANDOFF_META).toContain('leading-5');
    expect(TIMELINE_HANDOFF_META).not.toContain('hidden');
  });

  it('stacks below sm and never takes a desktop-only sm override', () => {
    expect(TIMELINE_HANDOFF_META).not.toMatch(/(^|\s)sm:/);
    expect(TIMELINE_HANDOFF_META).toContain('max-sm:items-start');
    expect(TIMELINE_HANDOFF_META).toContain('max-sm:basis-full');
    expect(TIMELINE_HANDOFF_META).toContain('max-sm:max-w-full');
    expect(TIMELINE_HANDOFF_META).toContain('max-sm:pl-[1.375rem]');
    expect(TIMELINE_HANDOFF_META).toContain('max-sm:leading-4');
  });

  it('stacks below sm with the below-sm stacking classes', () => {
    for (const cls of BELOW_SM_STACKING_CLASSES) {
      expect(TIMELINE_HANDOFF_META.split(' ')).toContain(cls);
    }
  });
});

describe('TIMELINE_HANDOFF_META_TIME_ROW', () => {
  it('is one line that right-aligns the timestamp and duration slot: 20px from sm, 16px below', () => {
    expect(TIMELINE_HANDOFF_META_TIME_ROW).toContain('h-5');
    expect(TIMELINE_HANDOFF_META_TIME_ROW).toContain('items-center');
    expect(TIMELINE_HANDOFF_META_TIME_ROW).toContain('justify-end');
    expect(TIMELINE_HANDOFF_META_TIME_ROW).toContain('whitespace-nowrap');
    expect(TIMELINE_HANDOFF_META_TIME_ROW).toContain('max-sm:h-4');
    expect(TIMELINE_HANDOFF_META_TIME_ROW).toContain('max-sm:justify-start');
    expect(TIMELINE_HANDOFF_META_TIME_ROW).not.toMatch(/(^|\s)sm:/);
  });
});

describe('TIMELINE_HANDOFF_DURATION_SLOT', () => {
  it('is exactly the fixed 7ch slot used by the expanded footer at every width', () => {
    expect(TIMELINE_HANDOFF_DURATION_SLOT).toBe(
      'w-[7ch] shrink-0 truncate text-left font-mono text-[10px] tabular-nums'
    );
  });
});

describe('TIMELINE_HANDOFF_META_DURATION_SLOT', () => {
  it('extends the 7ch slot with an unclipped auto width below sm for the collapsed bar', () => {
    expect(TIMELINE_HANDOFF_META_DURATION_SLOT).toContain('w-[7ch]');
    expect(TIMELINE_HANDOFF_META_DURATION_SLOT).toContain('truncate');
    expect(TIMELINE_HANDOFF_META_DURATION_SLOT).toContain('max-sm:w-auto');
    expect(TIMELINE_HANDOFF_META_DURATION_SLOT).toContain('max-sm:overflow-visible');
  });
});

describe('TIMELINE_BAR_META_PLAIN', () => {
  it('stacks below sm with the below-sm stacking classes', () => {
    for (const cls of BELOW_SM_STACKING_CLASSES) {
      expect(TIMELINE_BAR_META_PLAIN.split(' ')).toContain(cls);
    }
  });
});

describe('TIMELINE_HANDOFF_TIMESTAMP', () => {
  it('truncates without a text-alignment utility: the time row and the fixed slot own its right edge', () => {
    expect(TIMELINE_HANDOFF_TIMESTAMP).not.toContain('text-right');
    expect(TIMELINE_HANDOFF_TIMESTAMP).toContain('min-w-0');
    expect(TIMELINE_HANDOFF_TIMESTAMP).toContain('truncate');
    expect(TIMELINE_HANDOFF_TIMESTAMP).toContain('text-chatroom-text-muted');
  });
});

describe('TIMELINE_FOOTER_TIMESTAMP', () => {
  it('keeps the pre-change non-handoff timestamp classes', () => {
    expect(TIMELINE_FOOTER_TIMESTAMP).toBe(
      'text-[10px] font-mono font-bold tabular-nums whitespace-nowrap text-chatroom-text-muted'
    );
  });
});

describe('TIMELINE_HANDOFF_FOOTER', () => {
  it('is a two-column grid with the controls and the time row on the first row', () => {
    expect(TIMELINE_HANDOFF_FOOTER).toContain('grid');
    expect(TIMELINE_HANDOFF_FOOTER).toContain('grid-cols-[auto_minmax(0,1fr)]');
    expect(TIMELINE_HANDOFF_FOOTER).toContain('mt-2');
    expect(TIMELINE_HANDOFF_FOOTER).toContain('pt-1.5');
  });
});

describe('TIMELINE_HANDOFF_FOOTER_TIME_ROW', () => {
  it('pushes the timestamp and duration to the right edge', () => {
    expect(TIMELINE_HANDOFF_FOOTER_TIME_ROW).toContain('justify-end');
    expect(TIMELINE_HANDOFF_FOOTER_TIME_ROW).toContain('min-w-0');
    expect(TIMELINE_HANDOFF_FOOTER_TIME_ROW).toContain('whitespace-nowrap');
  });
});

describe('TIMELINE_HANDOFF_FOOTER_AGENT_ROW', () => {
  it('spans both columns and right-flushes the agent line, collapsing when empty', () => {
    expect(TIMELINE_HANDOFF_FOOTER_AGENT_ROW).toContain('col-span-2');
    expect(TIMELINE_HANDOFF_FOOTER_AGENT_ROW).toContain('justify-end');
    expect(TIMELINE_HANDOFF_FOOTER_AGENT_ROW).toContain('empty:hidden');
  });
});

describe('TIMELINE_AGENT_LINE', () => {
  it('is plain muted mono text with no background, padding or uppercase', () => {
    expect(TIMELINE_AGENT_LINE).toContain('font-mono');
    expect(TIMELINE_AGENT_LINE).toContain('text-[10px]');
    expect(TIMELINE_AGENT_LINE).toContain('text-chatroom-text-muted');
    expect(TIMELINE_AGENT_LINE).not.toContain('uppercase');
    expect(TIMELINE_AGENT_LINE).not.toMatch(/\bpx-/);
    expect(TIMELINE_AGENT_LINE).not.toMatch(/\bbg-/);
    expect(TIMELINE_AGENT_LINE).not.toMatch(HARD_CODED_COLOUR);
  });
});

describe('TIMELINE_AGENT_PLACEMENT', () => {
  it('gives the footer and the bar different harness and model budgets', () => {
    expect(TIMELINE_AGENT_PLACEMENT.footer.harness).toBe('max-w-[14ch] sm:max-w-[20ch]');
    expect(TIMELINE_AGENT_PLACEMENT.footer.model).toBe('max-w-[40ch] sm:max-w-[65ch]');
    expect(TIMELINE_AGENT_PLACEMENT.footer.line).toBe('');
    expect(TIMELINE_AGENT_PLACEMENT.bar.line).toContain('max-sm:hidden');
    expect(TIMELINE_AGENT_PLACEMENT.bar.harness).toContain('md:max-w-[16ch]');
    expect(TIMELINE_AGENT_PLACEMENT.bar.model).toBe('max-w-full');
  });
});

describe('TIMELINE_AGENT_HARNESS / TIMELINE_AGENT_MODEL / TIMELINE_AGENT_DOT', () => {
  it('keeps the harness capped, the model flexible, and the dot fixed', () => {
    expect(TIMELINE_AGENT_HARNESS).toBe('shrink-0 truncate');
    expect(TIMELINE_AGENT_MODEL).toBe('min-w-0 truncate');
    expect(TIMELINE_AGENT_DOT).toBe('shrink-0');
  });
});

describe('TIMELINE_PLAN_LABEL', () => {
  it('is a small caps label using only chatroom tokens', () => {
    expect(TIMELINE_PLAN_LABEL).toContain('uppercase');
    expect(TIMELINE_PLAN_LABEL).toContain('text-chatroom-text-muted');
    expect(TIMELINE_PLAN_LABEL).not.toMatch(HARD_CODED_COLOUR);
  });
});

describe('TIMELINE_PLAN_CONTROL', () => {
  it('is a hoverable, focus-ringed control with reduced-motion support', () => {
    expect(TIMELINE_PLAN_CONTROL).toContain('hover:bg-chatroom-bg-hover');
    expect(TIMELINE_PLAN_CONTROL).toContain('focus-visible:ring-chatroom-accent');
    expect(TIMELINE_PLAN_CONTROL).toContain('motion-reduce:transition-none');
    expect(TIMELINE_PLAN_CONTROL).not.toMatch(HARD_CODED_COLOUR);
  });
});
