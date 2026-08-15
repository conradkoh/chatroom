import { describe, expect, it } from 'vitest';

import { decodeHtmlEntities } from './decodeHtmlEntities';

describe('decodeHtmlEntities', () => {
  it('decodes entities repeatedly', () => {
    expect(decodeHtmlEntities('&amp;lt;p&amp;gt;')).toBe('<p>');
    expect(decodeHtmlEntities('&amp;amp;amp;nbsp;')).toBe('\u00a0');
  });
});
