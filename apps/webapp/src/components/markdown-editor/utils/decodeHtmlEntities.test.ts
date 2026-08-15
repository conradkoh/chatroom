import { describe, expect, it } from 'vitest';
import { decodeHtmlEntities } from './decodeHtmlEntities';
describe('decodeHtmlEntities', () => {
  it('decodes encoded tags and repeated entities', () => {
    expect(decodeHtmlEntities('&amp;lt;p&amp;gt;Hello&amp;lt;/p&amp;gt;')).toBe('<p>Hello</p>');
    expect(decodeHtmlEntities('&amp;amp;amp;nbsp;')).toBe('\u00A0');
  });
  it('leaves markdown unchanged', () => expect(decodeHtmlEntities('## Summary\nFoo')).toBe('## Summary\nFoo'));
});
