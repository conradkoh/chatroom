/**
 * daemon-state Event Cursor Tests
 *
 * Tests for persistEventCursor and loadEventCursor:
 *   1. Cursor is loaded from persisted state on startup (if present)
 *   2. Cursor is saved after processing a batch of events
 *   3. If no persisted cursor exists, loadEventCursor returns null (fallback to query)
 */

import { existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import { loadEventCursor, persistEventCursor } from './daemon-state.js';

// ---------------------------------------------------------------------------
// Mocks — must be defined before importing the module under test
// ---------------------------------------------------------------------------

const mockState: {
  exists: boolean;
  content: Record<string, unknown>;
} = {
  exists: false,
  content: {},
};

vi.mock('node:fs', () => ({
  existsSync: vi.fn((path: string) => {
    // State directory always "exists" to avoid mkdirSync calls in loadOrCreate
    if (path.includes('state') && !path.endsWith('.json')) return true;
    return mockState.exists;
  }),
  mkdirSync: vi.fn(),
  readFileSync: vi.fn(() => JSON.stringify(mockState.content)),
  writeFileSync: vi.fn(),
  renameSync: vi.fn(),
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
// Tests
// ---------------------------------------------------------------------------

describe('loadEventCursor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockState.exists = false;
    mockState.content = {};
  });

  it('returns null when no state file exists', () => {
    mockState.exists = false;

    const result = loadEventCursor('machine-abc');

    expect(result).toBeNull();
  });

  it('returns null when state file exists but has no lastSeenEventId', () => {
    mockState.exists = true;
    mockState.content = {
      version: '1',
      machineId: 'machine-abc',
      updatedAt: '2026-01-01T00:00:00.000Z',
      agents: {},
    };

    const result = loadEventCursor('machine-abc');

    expect(result).toBeNull();
  });

  it('returns the persisted cursor when lastSeenEventId is present', () => {
    mockState.exists = true;
    mockState.content = {
      version: '1',
      machineId: 'machine-abc',
      updatedAt: '2026-01-01T00:00:00.000Z',
      agents: {},
      lastSeenEventId: 'event-id-xyz',
    };

    const result = loadEventCursor('machine-abc');

    expect(result).toBe('event-id-xyz');
  });
});

describe('persistEventCursor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockState.exists = true;
    mockState.content = {
      version: '1',
      machineId: 'machine-abc',
      updatedAt: '2026-01-01T00:00:00.000Z',
      agents: {},
    };
  });

  it('writes lastSeenEventId to the state file', () => {
    persistEventCursor('machine-abc', 'event-id-xyz');

    expect(writeFileSync).toHaveBeenCalledOnce();
    const [, content] = (writeFileSync as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      string,
      unknown,
    ];
    const written = JSON.parse(content) as { lastSeenEventId?: string };
    expect(written.lastSeenEventId).toBe('event-id-xyz');
  });

  it('performs atomic write via temp file and rename', () => {
    persistEventCursor('machine-abc', 'event-id-xyz');

    expect(writeFileSync).toHaveBeenCalledOnce();
    const [writtenPath] = (writeFileSync as ReturnType<typeof vi.fn>).mock.calls[0] as [string];
    expect(writtenPath).toMatch(/\.tmp$/);

    expect(renameSync).toHaveBeenCalledOnce();
    const [from, to] = (renameSync as ReturnType<typeof vi.fn>).mock.calls[0] as [string, string];
    expect(from).toMatch(/\.tmp$/);
    expect(to).not.toMatch(/\.tmp$/);
    expect(to).toBe(from.replace('.tmp', ''));
  });

  it('does not throw when the write fails — best-effort persistence', () => {
    (writeFileSync as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
      throw new Error('disk full');
    });

    // Should not throw
    expect(() => persistEventCursor('machine-abc', 'event-id-xyz')).not.toThrow();
  });

  it('creates a fresh state file when none exists, preserving the cursor', () => {
    mockState.exists = false;

    persistEventCursor('machine-abc', 'event-id-new');

    expect(writeFileSync).toHaveBeenCalledOnce();
    const [, content] = (writeFileSync as ReturnType<typeof vi.fn>).mock.calls[0] as [
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
