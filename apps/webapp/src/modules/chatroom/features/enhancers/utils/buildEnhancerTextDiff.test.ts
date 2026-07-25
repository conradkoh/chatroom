import { describe, expect, it } from 'vitest';

import { buildEnhancerTextDiff } from './buildEnhancerTextDiff';

describe('buildEnhancerTextDiff', () => {
  it('returns empty diff for identical content', () => {
    const diff = buildEnhancerTextDiff('line one\nline two', 'line one\nline two');

    expect(diff.unified).toEqual([
      { type: 'unchanged', content: 'line one' },
      { type: 'unchanged', content: 'line two' },
    ]);
    expect(diff.split.before.lines).toHaveLength(2);
    expect(diff.split.after.lines).toHaveLength(2);
  });

  it('builds unified additions and deletions', () => {
    const diff = buildEnhancerTextDiff('old line', 'new line');

    expect(diff.unified).toEqual([
      { type: 'deletion', content: 'old line' },
      { type: 'addition', content: 'new line' },
    ]);
  });

  it('aligns split panes with empty placeholders', () => {
    const diff = buildEnhancerTextDiff('old line', 'new line');

    expect(diff.split.before.lines[0]).toMatchObject({ type: 'deletion', content: 'old line' });
    expect(diff.split.after.lines[0]).toMatchObject({ type: 'empty', content: '' });
    expect(diff.split.before.lines[1]).toMatchObject({ type: 'empty', content: '' });
    expect(diff.split.after.lines[1]).toMatchObject({ type: 'addition', content: 'new line' });
  });

  it('preserves unchanged lines in both panes', () => {
    const diff = buildEnhancerTextDiff('keep\nold', 'keep\nnew');

    expect(diff.unified[0]).toEqual({ type: 'unchanged', content: 'keep' });
    expect(diff.split.before.lines[0]).toMatchObject({ type: 'unchanged', content: 'keep' });
    expect(diff.split.after.lines[0]).toMatchObject({ type: 'unchanged', content: 'keep' });
  });
});
