import { describe, expect, it } from 'vitest';

import { getWorkQueuePreviewText } from './getWorkQueuePreviewText';

describe('getWorkQueuePreviewText', () => {
  it('strips handoff XML tags', () => {
    const input = '<handoff-overview>## Summary\nFoo</handoff-overview>';
    expect(getWorkQueuePreviewText(input)).toContain('## Summary');
    expect(getWorkQueuePreviewText(input)).not.toContain('<handoff-');
  });

  it('strips ---MESSAGE--- prefix', () => {
    const input = '---MESSAGE---\nHello world';
    expect(getWorkQueuePreviewText(input)).toBe('Hello world');
  });

  it('handles backlog #5 sample handoff', () => {
    const input = `<handoff-overview>
## Summary
Implemented login

## What changed
Added auth
</handoff-overview>

---MESSAGE---
Original content after message marker`;

    const result = getWorkQueuePreviewText(input);
    expect(result).toContain('## Summary');
    expect(result).not.toContain('<handoff-');
    expect(result).not.toContain('---MESSAGE---');
  });
});
