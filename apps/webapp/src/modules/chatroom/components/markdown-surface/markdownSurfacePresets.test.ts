import { describe, expect, it } from 'vitest';
import {
  markdownSurfaceBaseProseClassNames,
  markdownSurfaceFeedProseClassNames,
  markdownSurfaceModalProseClassNames,
} from './markdownSurfacePresets';
describe('markdown surface presets', () => {
  it('composes canonical base styles', () => {
    expect(markdownSurfaceBaseProseClassNames).toContain('prose-pre:bg-chatroom-bg-secondary');
    expect(markdownSurfaceBaseProseClassNames).toContain('prose-code:before:content-none');
  });
  it('composes feed density', () => {
    expect(markdownSurfaceFeedProseClassNames).toContain('prose-table:overflow-x-auto');
  });
  it('composes modal editor selectors once', () => {
    expect(markdownSurfaceModalProseClassNames).toContain('ProseMirror_pre');
    const sig = 'prose-pre:overflow-x-hidden';
    expect(markdownSurfaceModalProseClassNames.indexOf(sig)).toBe(
      markdownSurfaceModalProseClassNames.lastIndexOf(sig)
    );
  });
});
