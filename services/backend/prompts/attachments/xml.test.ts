import { describe, expect, test } from 'vitest';

import { escapeXmlAttribute, escapeXmlText, xmlTextElement } from './xml.js';

describe('escapeXmlText', () => {
  test('escapes &, <, >', () => {
    expect(escapeXmlText('foo & bar <baz>')).toBe('foo &amp; bar &lt;baz&gt;');
  });
});

describe('escapeXmlAttribute', () => {
  test('escapes &, <, >, and "', () => {
    expect(escapeXmlAttribute('a"b & <c>')).toBe('a&quot;b &amp; &lt;c&gt;');
  });
});

describe('xmlTextElement', () => {
  test('renders single-line element with escaped content', () => {
    expect(xmlTextElement('content', 'foo & bar <baz>')).toEqual([
      '    <content>foo &amp; bar &lt;baz&gt;</content>',
    ]);
  });

  test('renders multiline element with escaped content', () => {
    expect(xmlTextElement('content', 'line one\nline & two')).toEqual([
      '    <content>',
      'line one\nline &amp; two',
      '    </content>',
    ]);
  });
});
