import { describe, expect, test } from 'vitest';

import { compressContextToWantResume, parseCompressContext } from './parse-compress-context';

const SECTION = `## Restart new context
Hard = Full reset | Compact = Compress context | None = continue with previous context`;

describe('parseCompressContext', () => {
  test('extracts reset from section', () => {
    const content = `${SECTION}
// data:agent.compress_context=reset`;
    expect(parseCompressContext(content)).toBe('reset');
  });

  test('extracts compact from section', () => {
    const content = `${SECTION}
// data:agent.compress_context=compact`;
    expect(parseCompressContext(content)).toBe('compact');
  });

  test('extracts none from section', () => {
    const content = `${SECTION}
// data:agent.compress_context=none`;
    expect(parseCompressContext(content)).toBe('none');
  });

  test('defaults to none when section is missing', () => {
    expect(parseCompressContext('## Goal\nDo the thing')).toBe('none');
  });

  test('defaults to none when tag is missing from section', () => {
    expect(parseCompressContext(SECTION)).toBe('none');
  });

  test('defaults to none for invalid tag value', () => {
    const content = `${SECTION}
// data:agent.compress_context=invalid`;
    expect(parseCompressContext(content)).toBe('none');
  });

  test('uses first tag within section when multiple present', () => {
    const content = `${SECTION}
// data:agent.compress_context=reset
// data:agent.compress_context=none`;
    expect(parseCompressContext(content)).toBe('reset');
  });

  test('does not read tag outside Restart new context section', () => {
    const content = `// data:agent.compress_context=reset
${SECTION}
// data:agent.compress_context=none`;
    expect(parseCompressContext(content)).toBe('none');
  });

  test('stops at next ## heading', () => {
    const content = `${SECTION}
// data:agent.compress_context=reset

## Goal
// data:agent.compress_context=none`;
    expect(parseCompressContext(content)).toBe('reset');
  });

  test('is case-insensitive on tag value', () => {
    const content = `${SECTION}
// data:agent.compress_context=RESET`;
    expect(parseCompressContext(content)).toBe('reset');
  });
});

describe('compressContextToWantResume', () => {
  test('none → resume prior session', () => {
    expect(compressContextToWantResume('none')).toBe(true);
  });

  test('reset → cold spawn', () => {
    expect(compressContextToWantResume('reset')).toBe(false);
  });

  test('compact → cold spawn (v1 same as reset)', () => {
    expect(compressContextToWantResume('compact')).toBe(false);
  });
});
