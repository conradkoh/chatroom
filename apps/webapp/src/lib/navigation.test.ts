import { afterEach, describe, expect, it, vi } from 'vitest';

import { openExternalUrl } from './navigation';

describe('openExternalUrl', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('opens a transient anchor with external link attributes', () => {
    const click = vi.fn();
    const appendChild = vi.spyOn(document.body, 'appendChild');
    const removeChild = vi.spyOn(document.body, 'removeChild');
    const createElement = vi.spyOn(document, 'createElement');

    createElement.mockImplementation((tagName: string) => {
      const element = document.createElementNS('http://www.w3.org/1999/xhtml', tagName);
      element.click = click;
      return element;
    });

    openExternalUrl('https://github.com/owner/repo/pulls');

    expect(createElement).toHaveBeenCalledWith('a');
    const anchor = appendChild.mock.calls[0]![0] as HTMLAnchorElement;
    expect(anchor.href).toBe('https://github.com/owner/repo/pulls');
    expect(anchor.target).toBe('_blank');
    expect(anchor.rel).toBe('noopener noreferrer');
    expect(click).toHaveBeenCalledOnce();
    expect(removeChild).toHaveBeenCalledWith(anchor);
  });
});
