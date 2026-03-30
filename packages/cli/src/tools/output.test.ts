/**
 * Output Helpers — Unit Tests
 *
 * Tests the .chatroom/ directory management utilities using injected
 * dependencies (fake in-memory fs). No real file system access.
 */

import { describe, expect, it } from 'vitest';

import type { OutputDeps } from './output.js';
import {
  resolveChatroomDir,
  ensureChatroomDir,
  ensureGitignore,
  formatOutputTimestamp,
  generateOutputPath,
} from './output.js';

// ─── Fake FS ────────────────────────────────────────────────────────────────

function createFakeFs(initialFiles: Record<string, string> = {}): {
  store: Map<string, string>;
  mkdirCalls: string[];
  deps: OutputDeps;
} {
  const store = new Map<string, string>(Object.entries(initialFiles));
  const mkdirCalls: string[] = [];

  const deps: OutputDeps = {
    fs: {
      mkdir: async (p: string, _opts: { recursive: boolean }) => {
        mkdirCalls.push(p);
      },
      readFile: async (p: string, _encoding: BufferEncoding) => {
        const content = store.get(p);
        if (content === undefined) throw new Error(`ENOENT: ${p}`);
        return content;
      },
      appendFile: async (p: string, content: string) => {
        const existing = store.get(p) ?? '';
        store.set(p, existing + content);
      },
      access: async (p: string) => {
        if (!store.has(p)) throw new Error(`ENOENT: ${p}`);
      },
    },
  };

  return { store, mkdirCalls, deps };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('resolveChatroomDir', () => {
  it('resolves .chatroom/ under the working directory', () => {
    expect(resolveChatroomDir('/home/user/project')).toBe('/home/user/project/.chatroom');
  });

  it('handles trailing slash', () => {
    // path.join normalizes this
    expect(resolveChatroomDir('/home/user/project/')).toBe('/home/user/project/.chatroom');
  });
});

describe('ensureChatroomDir', () => {
  it('creates the .chatroom/ directory', async () => {
    const { mkdirCalls, deps } = createFakeFs();
    const dir = await ensureChatroomDir(deps, '/project');

    expect(dir).toBe('/project/.chatroom');
    expect(mkdirCalls).toContain('/project/.chatroom');
  });
});

describe('ensureGitignore', () => {
  it('creates .gitignore with .chatroom entry if file does not exist', async () => {
    const { store, deps } = createFakeFs();
    await ensureGitignore(deps, '/project');

    const content = store.get('/project/.gitignore');
    expect(content).toBe('.chatroom\n');
  });

  it('appends .chatroom entry if file exists without it', async () => {
    const { store, deps } = createFakeFs({
      '/project/.gitignore': 'node_modules\n.env\n',
    });

    await ensureGitignore(deps, '/project');

    const content = store.get('/project/.gitignore');
    expect(content).toContain('.chatroom\n');
    expect(content).toContain('node_modules');
  });

  it('adds newline separator when file does not end with newline', async () => {
    const { store, deps } = createFakeFs({
      '/project/.gitignore': 'node_modules',
    });

    await ensureGitignore(deps, '/project');

    const content = store.get('/project/.gitignore');
    expect(content).toBe('node_modules\n.chatroom\n');
  });

  it('skips if .chatroom is already in .gitignore', async () => {
    const original = 'node_modules\n.chatroom\n.env\n';
    const { store, deps } = createFakeFs({
      '/project/.gitignore': original,
    });

    await ensureGitignore(deps, '/project');

    // Content should be unchanged
    expect(store.get('/project/.gitignore')).toBe(original);
  });

  it('skips if .chatroom/ (with trailing slash) is in .gitignore', async () => {
    const original = 'node_modules\n.chatroom/\n.env\n';
    const { store, deps } = createFakeFs({
      '/project/.gitignore': original,
    });

    await ensureGitignore(deps, '/project');

    expect(store.get('/project/.gitignore')).toBe(original);
  });
});

describe('formatOutputTimestamp', () => {
  it('formats a known date correctly', () => {
    // 2026-03-30T16:30:00.123
    const date = new Date(2026, 2, 30, 16, 30, 0, 123);
    expect(formatOutputTimestamp(date)).toBe('20260330-163000-123');
  });

  it('pads single-digit values', () => {
    // 2026-01-05T03:04:05.007
    const date = new Date(2026, 0, 5, 3, 4, 5, 7);
    expect(formatOutputTimestamp(date)).toBe('20260105-030405-007');
  });
});

describe('generateOutputPath', () => {
  it('generates a timestamped path in the .chatroom/ directory', () => {
    const date = new Date(2026, 2, 30, 16, 30, 0, 123);
    const path = generateOutputPath('/project', 'parse-pdf', 'txt', date);

    expect(path).toBe('/project/.chatroom/parse-pdf-20260330-163000-123.txt');
  });

  it('works with different tool names and extensions', () => {
    const date = new Date(2026, 2, 30, 16, 30, 0, 123);
    const path = generateOutputPath('/project', 'screenshot', 'png', date);

    expect(path).toBe('/project/.chatroom/screenshot-20260330-163000-123.png');
  });
});
