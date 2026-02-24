/**
 * init Unit Tests
 *
 * Tests the init command using injected dependencies (fake in-memory fs).
 * Covers: no files exist, section absent, section already present (idempotent).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { InitDeps } from './deps.js';
import { init } from './index.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Creates an in-memory fake fs backed by a Map<path, content>. */
function createFakeFs(initialFiles: Record<string, string> = {}): {
  store: Map<string, string>;
  deps: InitDeps;
} {
  const store = new Map<string, string>(Object.entries(initialFiles));

  const deps: InitDeps = {
    fs: {
      access: async (p: string) => {
        if (!store.has(p)) throw new Error(`ENOENT: ${p}`);
      },
      readFile: async (p: string, _encoding: BufferEncoding) => {
        const content = store.get(p);
        if (content === undefined) throw new Error(`ENOENT: ${p}`);
        return content;
      },
      writeFile: async (p: string, content: string, _encoding: BufferEncoding) => {
        store.set(p, content);
      },
    },
  };

  return { store, deps };
}

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

let _logSpy: any;

let _errorSpy: any;

beforeEach(() => {
  _logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  _errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('init', () => {
  describe('no files exist', () => {
    it('creates AGENTS.md with the CHATROOM INTEGRATION section', async () => {
      const { store, deps } = createFakeFs();
      const dir = '/fake/project';

      const result = await init({ dir }, deps);

      expect(result.filesCreated).toContain('AGENTS.md');
      expect(result.filesModified).toHaveLength(0);
      expect(result.filesSkipped).toHaveLength(0);

      const written = store.get(`${dir}/AGENTS.md`);
      expect(written).toBeDefined();
      expect(written).toContain('CHATROOM INTEGRATION');
      expect(written).toContain('Workflow Loop');
      expect(written).toContain('Reliability');
      expect(written).toContain('Command Reference');
      expect(written).toContain('Context Recovery');
    });
  });

  describe('file exists, section absent', () => {
    it('appends section and file is in filesModified', async () => {
      const dir = '/fake/project';
      const existingContent = '# My Project\n\nSome existing content here.\n';
      const { store, deps } = createFakeFs({
        [`${dir}/AGENTS.md`]: existingContent,
      });

      const result = await init({ dir }, deps);

      expect(result.filesModified).toContain('AGENTS.md');
      expect(result.filesCreated).toHaveLength(0);
      expect(result.filesSkipped).toHaveLength(0);

      const written = store.get(`${dir}/AGENTS.md`);
      expect(written).toBeDefined();
      // Original content preserved
      expect(written).toContain('My Project');
      expect(written).toContain('Some existing content here.');
      // Section appended
      expect(written).toContain('CHATROOM INTEGRATION');
      expect(written).toContain('Workflow Loop');
      expect(written).toContain('Reliability');
      expect(written).toContain('Command Reference');
      expect(written).toContain('Context Recovery');
    });
  });

  describe('file exists, section already present', () => {
    it('replaces the section in place, file is in filesModified (not filesSkipped)', async () => {
      const dir = '/fake/project';
      const oldSection =
        '## 6. CHATROOM INTEGRATION\n\nOld content here that should be replaced.\n';
      const existingContent = `# My Project\n\nMain content.\n\n---\n\n${oldSection}`;
      const { store, deps } = createFakeFs({
        [`${dir}/AGENTS.md`]: existingContent,
      });

      const result = await init({ dir }, deps);

      expect(result.filesModified).toContain('AGENTS.md');
      expect(result.filesCreated).toHaveLength(0);
      expect(result.filesSkipped).toHaveLength(0);

      const written = store.get(`${dir}/AGENTS.md`);
      expect(written).toBeDefined();
      // Original preamble preserved
      expect(written).toContain('My Project');
      expect(written).toContain('Main content.');
      // Old section content gone
      expect(written).not.toContain('Old content here that should be replaced.');
      // New section present
      expect(written).toContain('CHATROOM INTEGRATION');
      expect(written).toContain('Workflow Loop');
      expect(written).toContain('Reliability');
      expect(written).toContain('Command Reference');
      expect(written).toContain('Context Recovery');
      // No duplicate headings
      const matches = (written ?? '').match(/CHATROOM INTEGRATION/g);
      expect(matches).toHaveLength(1);
    });
  });

  describe('idempotency', () => {
    it('running init twice produces the same result without duplication', async () => {
      const dir = '/fake/project';
      const existingContent = '# My Project\n\nMain content.\n';
      const { store, deps } = createFakeFs({
        [`${dir}/AGENTS.md`]: existingContent,
      });

      // First run — appends section
      const result1 = await init({ dir }, deps);
      expect(result1.filesModified).toContain('AGENTS.md');

      // Second run — replaces section in place
      const result2 = await init({ dir }, deps);
      expect(result2.filesModified).toContain('AGENTS.md');
      expect(result2.filesSkipped).toHaveLength(0);

      const finalContent = store.get(`${dir}/AGENTS.md`) ?? '';
      // Section appears exactly once
      const matches = finalContent.match(/CHATROOM INTEGRATION/g);
      expect(matches).toHaveLength(1);
      // New section content present
      expect(finalContent).toContain('Workflow Loop');
      expect(finalContent).toContain('Context Recovery');
    });
  });
});
