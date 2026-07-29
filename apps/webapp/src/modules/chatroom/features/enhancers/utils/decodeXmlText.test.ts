import { describe, expect, it } from 'vitest';
import { decodeXmlText } from './decodeXmlText';

describe('decodeXmlText', () => {
  it('decodes angle brackets', () => {
    expect(decodeXmlText('&lt;RequireFamilyMember&gt;')).toBe('<RequireFamilyMember>');
  });

  it('decodes ampersand and quotes', () => {
    expect(decodeXmlText('foo &amp; bar &quot;baz&quot;')).toBe('foo & bar "baz"');
  });

  it('leaves plain text unchanged', () => {
    expect(decodeXmlText('<already-decoded>')).toBe('<already-decoded>');
  });
});
