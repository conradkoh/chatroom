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
      expect(written).toContain('<chatroom>');
      expect(written).toContain('</chatroom>');
      expect(written).toContain('CHATROOM INTEGRATION');
      expect(written).toContain('Workflow Loop');
      expect(written).toContain('Reliability');
      expect(written).toContain('Command Reference');
      expect(written).toContain('Context Recovery');
      expect(written).not.toContain('CHATROOM_CONVEX_URL=<endpoint>');
      expect(written).toContain('chatroom get-next-task --chatroom-id=<id> --role=<role>');
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
      // Section appended with tags
      expect(written).toContain('<chatroom>');
      expect(written).toContain('</chatroom>');
      expect(written).toContain('CHATROOM INTEGRATION');
      expect(written).toContain('Workflow Loop');
      expect(written).toContain('Reliability');
      expect(written).toContain('Command Reference');
      expect(written).toContain('Context Recovery');
    });
  });

  describe('file exists, section already present', () => {
    it('replaces the section in place using <chatroom> tags, file is in filesModified (not filesSkipped)', async () => {
      const dir = '/fake/project';
      const oldSection =
        '<chatroom>\n## CHATROOM INTEGRATION\n\nOld content here that should be replaced.\n</chatroom>';
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
      // New section present with tags
      expect(written).toContain('<chatroom>');
      expect(written).toContain('</chatroom>');
      expect(written).toContain('CHATROOM INTEGRATION');
      expect(written).toContain('Workflow Loop');
      expect(written).toContain('Reliability');
      expect(written).toContain('Command Reference');
      expect(written).toContain('Context Recovery');
      // No duplicate chatroom tags
      const openMatches = (written ?? '').match(/<chatroom>/g);
      expect(openMatches).toHaveLength(1);
    });

    it('gracefully appends when old heading-only format (no tags) is present', async () => {
      const dir = '/fake/project';
      // Old format: heading but no <chatroom> tags
      const oldSection = '## 6. CHATROOM INTEGRATION\n\nOld heading-only format.\n';
      const existingContent = `# My Project\n\nMain content.\n\n---\n\n${oldSection}`;
      const { store, deps } = createFakeFs({
        [`${dir}/AGENTS.md`]: existingContent,
      });

      const result = await init({ dir }, deps);

      // No <chatroom> tag in old content → hasIntegrationSection returns false → append
      expect(result.filesModified).toContain('AGENTS.md');

      const written = store.get(`${dir}/AGENTS.md`);
      expect(written).toBeDefined();
      expect(written).toContain('<chatroom>');
      expect(written).toContain('</chatroom>');
      expect(written).toContain('Workflow Loop');
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
      // <chatroom> tag appears exactly once
      const openMatches = finalContent.match(/<chatroom>/g);
      expect(openMatches).toHaveLength(1);
      const closeMatches = finalContent.match(/<\/chatroom>/g);
      expect(closeMatches).toHaveLength(1);
      // New section content present
      expect(finalContent).toContain('Workflow Loop');
      expect(finalContent).toContain('Context Recovery');
    });
  });

  describe('InitFsService', () => {
    it('access returns true when file exists', async () => {
      const dir = '/fake/project';
      const { deps } = createFakeFs({
        [`${dir}/AGENTS.md`]: '# Existing',
      });

      const result = await init({ dir }, deps);

      // File existed and was modified
      expect(result.filesModified).toContain('AGENTS.md');
    });

    it('access returns false when file missing', async () => {
      const dir = '/fake/project';
      const { deps } = createFakeFs();

      const result = await init({ dir }, deps);

      // File didn't exist and was created
      expect(result.filesCreated).toContain('AGENTS.md');
    });

    it('init continues when readFile fails for one file (logs error, processes others)', async () => {
      const dir = '/fake/project';
      const { deps } = createFakeFs({
        [`${dir}/AGENTS.md`]: '# Existing',
        [`${dir}/CLAUDE.md`]: '# Existing',
      });

      // Make readFile fail for AGENTS.md only by clearing it from the store after access check
      const originalReadFile = deps.fs.readFile;
      deps.fs.readFile = async (p: string, enc: BufferEncoding) => {
        if (p === `${dir}/AGENTS.md`) {
          throw new Error('Read failed');
        }
        return originalReadFile(p, enc);
      };

      const result = await init({ dir }, deps);

      // AGENTS.md failed to read, so it's not modified
      expect(result.filesModified).not.toContain('AGENTS.md');
      // CLAUDE.md was processed successfully
      expect(result.filesModified).toContain('CLAUDE.md');
    });
  });
});
