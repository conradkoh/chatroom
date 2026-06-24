import { describe, expect, test } from 'vitest';

import { compressContextToWantResume, parseCompressContext } from './parse-compress-context';

const LEGACY_SECTION = `## Restart new context
Hard = Full reset | Compact = Compress context | None = continue with previous context`;

const SESSION_SECTION = `## Session Management
Valid values: \`new_session\` | \`none\``;

describe('parseCompressContext', () => {
  test('extracts new_session from Session Management section', () => {
    const content = `${SESSION_SECTION}
// data:agent.compress_context=new_session`;
    expect(parseCompressContext(content)).toBe('new_session');
  });

  test('maps legacy reset to new_session', () => {
    const content = `${LEGACY_SECTION}
// data:agent.compress_context=reset`;
    expect(parseCompressContext(content)).toBe('new_session');
  });

  test('extracts none from section', () => {
    const content = `${SESSION_SECTION}
// data:agent.compress_context=none`;
    expect(parseCompressContext(content)).toBe('none');
  });

  test('defaults to new_session when section is missing', () => {
    expect(parseCompressContext('## Goal\nDo the thing')).toBe('new_session');
  });

  test('defaults to new_session when tag is missing from section', () => {
    expect(parseCompressContext(SESSION_SECTION)).toBe('new_session');
  });

  test('defaults to new_session for invalid tag value', () => {
    const content = `${SESSION_SECTION}
// data:agent.compress_context=invalid`;
    expect(parseCompressContext(content)).toBe('new_session');
  });

  test('uses first tag within section when multiple present', () => {
    const content = `${SESSION_SECTION}
// data:agent.compress_context=new_session
// data:agent.compress_context=none`;
    expect(parseCompressContext(content)).toBe('new_session');
  });

  test('does not read tag outside Session Management section', () => {
    const content = `// data:agent.compress_context=new_session
${SESSION_SECTION}
// data:agent.compress_context=none`;
    expect(parseCompressContext(content)).toBe('none');
  });

  test('stops at next ## heading', () => {
    const content = `${SESSION_SECTION}
// data:agent.compress_context=new_session

## Goal
// data:agent.compress_context=none`;
    expect(parseCompressContext(content)).toBe('new_session');
  });

  test('is case-insensitive on tag value', () => {
    const content = `${SESSION_SECTION}
// data:agent.compress_context=NEW_SESSION`;
    expect(parseCompressContext(content)).toBe('new_session');
  });

  test('accepts legacy Restart new context heading', () => {
    const content = `${LEGACY_SECTION}
// data:agent.compress_context=none`;
    expect(parseCompressContext(content)).toBe('none');
  });
});

describe('compressContextToWantResume', () => {
  test('none → resume prior session', () => {
    expect(compressContextToWantResume('none')).toBe(true);
  });

  test('new_session → cold spawn', () => {
    expect(compressContextToWantResume('new_session')).toBe(false);
  });
});
