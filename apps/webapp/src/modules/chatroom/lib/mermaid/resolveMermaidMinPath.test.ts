import { existsSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { resolveMermaidMinPath } from './resolveMermaidMinPath';

describe('resolveMermaidMinPath', () => {
  it('resolves an existing mermaid.min.js on disk', () => {
    const resolved = resolveMermaidMinPath();
    expect(resolved).toContain('mermaid.min.js');
    expect(existsSync(resolved)).toBe(true);
  });
});
