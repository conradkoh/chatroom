/**
 * daemon-state Event Cursor Tests
 *
 * Tests for persistEventCursor and loadEventCursor:
 *   1. Cursor is loaded from persisted state on startup (if present)
 *   2. Cursor is saved after processing a batch of events
 *   3. If no persisted cursor exists, loadEventCursor returns null (fallback to query)
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — must be defined before importing the module under test
// ---------------------------------------------------------------------------

const mockState: {
  content: Record<string, unknown>;
  readError?: NodeJS.ErrnoException;
} = {
  content: {},
};

vi.mock('node:fs/promises', () => ({
  mkdir: vi.fn(),
  readFile: vi.fn(async () => {
    if (mockState.readError) throw mockState.readError;
    return JSON.stringify(mockState.content);
  }),
  writeFile: vi.fn(async () => undefined),
  rename: vi.fn(async () => undefined),
}));

vi.mock('node:os', () => ({
  homedir: vi.fn(() => '/mock-home'),
}));

vi.mock('node:path', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:path')>();
  return {
    ...actual,
    join: actual.join,
  };
});

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import * as fs from 'node:fs/promises';

import { loadEventCursor, persistEventCursor } from './daemon-state.js';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('loadEventCursor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockState.content = {};
    mockState.readError = undefined;
  });

  afterEach(() => {
    mockState.readError = undefined;
  });

  it('returns null when no state file exists', async () => {
    mockState.readError = Object.assign(new Error('missing'), { code: 'ENOENT' as const });

    const result = await loadEventCursor('machine-abc');

    expect(result).toBeNull();
  });

  it('returns null when state file exists but has no lastSeenEventId', async () => {
    mockState.content = {
      version: '1',
      machineId: 'machine-abc',
      updatedAt: '2026-01-01T00:00:00.000Z',
      agents: {},
    };

    const result = await loadEventCursor('machine-abc');

    expect(result).toBeNull();
  });

  it('returns the persisted cursor when lastSeenEventId is present', async () => {
    mockState.content = {
      version: '1',
      machineId: 'machine-abc',
      updatedAt: '2026-01-01T00:00:00.000Z',
      agents: {},
      lastSeenEventId: 'event-id-xyz',
    };

    const result = await loadEventCursor('machine-abc');

    expect(result).toBe('event-id-xyz');
  });
});

describe('persistEventCursor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockState.content = {
      version: '1',
      machineId: 'machine-abc',
      updatedAt: '2026-01-01T00:00:00.000Z',
      agents: {},
    };
    mockState.readError = undefined;
  });

  it('writes lastSeenEventId to the state file', async () => {
    await persistEventCursor('machine-abc', 'event-id-xyz');

    expect(fs.writeFile).toHaveBeenCalledOnce();
    const [, content] = (fs.writeFile as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      string,
      unknown,
    ];
    const written = JSON.parse(content) as { lastSeenEventId?: string };
    expect(written.lastSeenEventId).toBe('event-id-xyz');
  });

  it('performs atomic write via temp file and rename', async () => {
    await persistEventCursor('machine-abc', 'event-id-xyz');

    expect(fs.writeFile).toHaveBeenCalledOnce();
    const [writtenPath] = (fs.writeFile as ReturnType<typeof vi.fn>).mock.calls[0] as [string];
    expect(writtenPath).toMatch(/\.tmp$/);

    expect(fs.rename).toHaveBeenCalledOnce();
    const [from, to] = (fs.rename as ReturnType<typeof vi.fn>).mock.calls[0] as [string, string];
    expect(from).toMatch(/\.tmp$/);
    expect(to).not.toMatch(/\.tmp$/);
    expect(to).toBe(from.replace('.tmp', ''));
  });

  it('does not throw when the write fails — best-effort persistence', async () => {
    (fs.writeFile as ReturnType<typeof vi.fn>).mockImplementationOnce(async () => {
      throw new Error('disk full');
    });

    await expect(persistEventCursor('machine-abc', 'event-id-xyz')).resolves.toBeUndefined();
  });

  it('creates a fresh state file when none exists, preserving the cursor', async () => {
    mockState.readError = Object.assign(new Error('missing'), { code: 'ENOENT' as const });

    await persistEventCursor('machine-abc', 'event-id-new');

    expect(fs.writeFile).toHaveBeenCalledOnce();
    const [, content] = (fs.writeFile as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      string,
      unknown,
    ];
    const written = JSON.parse(content) as {
      lastSeenEventId?: string;
      machineId?: string;
    };
    expect(written.lastSeenEventId).toBe('event-id-new');
    expect(written.machineId).toBe('machine-abc');
  });
});
