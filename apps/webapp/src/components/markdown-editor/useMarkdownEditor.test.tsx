import { describe, expect, it, vi } from 'vitest';
import { normalizeMarkdownContent } from './normalizeMarkdownContent';

describe('useMarkdownEditor', () => {
  it('normalizes legacy HTML content before notifying the consumer', async () => {
    const onUpdate = vi.fn((value: string) => value);
    onUpdate(normalizeMarkdownContent('<p>Legacy</p>'));
    expect(onUpdate).toHaveBeenCalledWith(expect.not.stringContaining('<p>'));
  });
});
