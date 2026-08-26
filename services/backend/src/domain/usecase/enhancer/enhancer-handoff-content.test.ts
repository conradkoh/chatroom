import { describe, expect, it } from 'vitest';
import {
  ENHANCER_USER_MESSAGE_PLACEHOLDER,
  resolveEnhancerHandoffContent,
} from './enhancer-handoff-content';

describe('resolveEnhancerHandoffContent', () => {
  it('injects the origin message into the placeholder', () => {
    expect(
      resolveEnhancerHandoffContent(
        `<user-message>${ENHANCER_USER_MESSAGE_PLACEHOLDER}</user-message>`,
        'Build it'
      )
    ).toContain('<user-message>Build it</user-message>');
  });
  it('leaves already-resolved user messages unchanged', () => {
    expect(
      resolveEnhancerHandoffContent('<user-message>Existing</user-message>', 'Origin')
    ).toContain('Existing');
  });
  it('prepends a user-message block when omitted', () => {
    expect(
      resolveEnhancerHandoffContent('<additional-context>Notes</additional-context>', 'Origin')
    ).toMatch(/^<user-message>\nOrigin/);
  });
  it('trims content and preserves additional context', () => {
    expect(
      resolveEnhancerHandoffContent('  <additional-context>Notes</additional-context>  ', 'Origin')
    ).toContain('<additional-context>Notes</additional-context>');
  });
});
