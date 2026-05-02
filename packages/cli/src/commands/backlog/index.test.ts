/**
 * backlog Unit Tests
 *
 * Tests the backlog commands using injected dependencies.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { BacklogDeps, BacklogFsOps } from './deps.js';
import {
  listBacklog,
  addBacklog,
  completeBacklog,
  exportBacklog,
  importBacklog,
  computeContentHash,
  updateBacklog,
  closeBacklog,
  type BacklogExportFile,
} from './index.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TEST_CHATROOM_ID = 'test_chatroom_id_12345678';
const TEST_SESSION_ID = 'test-session-id';
const TEST_TASK_ID = 'task_abc123_test_task_id_1';

function createMockFsOps(overrides?: Partial<BacklogFsOps>): BacklogFsOps {
  return {
    writeFile: vi.fn().mockResolvedValue(undefined),
    readFile: vi.fn().mockResolvedValue(''),
    mkdir: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function createMockDeps(overrides?: Partial<BacklogDeps>): BacklogDeps {
  return {
    backend: {
      mutation: vi.fn().mockResolvedValue({}),
      query: vi.fn().mockResolvedValue([]),
    },
    session: {
      getSessionId: vi.fn().mockReturnValue(TEST_SESSION_ID),
      getConvexUrl: vi.fn().mockReturnValue('http://test:3210'),
      getOtherSessionUrls: vi.fn().mockReturnValue([]),
    },
    fs: createMockFsOps(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

let exitSpy: any;

let logSpy: any;

let errorSpy: any;

beforeEach(() => {
  exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as never);
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

function getAllLogOutput(): string {
  return logSpy.mock.calls.map((c: unknown[]) => (c as string[]).join(' ')).join('\n');
}

function getAllErrorOutput(): string {
  return errorSpy.mock.calls.map((c: unknown[]) => (c as string[]).join(' ')).join('\n');
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('listBacklog', () => {
  it('exits with code 1 when not authenticated', async () => {
    const deps = createMockDeps({
      session: {
        getSessionId: vi.fn().mockReturnValue(null),
        getConvexUrl: vi.fn().mockReturnValue('http://test:3210'),
        getOtherSessionUrls: vi.fn().mockReturnValue([]),
      },
    });

    await listBacklog(TEST_CHATROOM_ID, { role: 'planner' }, deps);

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(getAllErrorOutput()).toContain('Not authenticated');
  });

  it('lists backlog items successfully', async () => {
    const deps = createMockDeps();
    const mockItems = [
      {
        _id: 'item1',
        content: 'Test backlog item',
        status: 'backlog',
        createdAt: Date.now(),
        assignedTo: null,
      },
    ];

    (deps.backend.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockItems);

    await listBacklog(TEST_CHATROOM_ID, { role: 'planner' }, deps);

    expect(exitSpy).not.toHaveBeenCalled();
    const output = getAllLogOutput();
    expect(output).toContain('BACKLOG');
    expect(output).toContain('Test backlog item');
  });

  it('exits with code 1 when query fails', async () => {
    const deps = createMockDeps();
    (deps.backend.query as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('Connection refused')
    );

    await listBacklog(TEST_CHATROOM_ID, { role: 'planner' }, deps);

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(getAllErrorOutput()).toContain('Failed to list backlog items');
  });
});

describe('addBacklog', () => {
  it('adds a backlog item', async () => {
    const deps = createMockDeps();
    (deps.backend.mutation as ReturnType<typeof vi.fn>).mockResolvedValue('new-item-id');

    await addBacklog(TEST_CHATROOM_ID, { role: 'planner', content: 'New backlog item' }, deps);

    expect(exitSpy).not.toHaveBeenCalled();
    expect(deps.backend.mutation).toHaveBeenCalledTimes(1);
    expect(getAllLogOutput()).toContain('Backlog item added');
  });

  it('exits with code 1 when content is empty', async () => {
    const deps = createMockDeps();

    await addBacklog(TEST_CHATROOM_ID, { role: 'planner', content: '' }, deps);

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(getAllErrorOutput()).toContain('Backlog item content cannot be empty');
  });
});

describe('completeBacklog', () => {
  it('completes a backlog item', async () => {
    const deps = createMockDeps();
    (deps.backend.mutation as ReturnType<typeof vi.fn>).mockResolvedValue({
      success: true,
    });

    await completeBacklog(TEST_CHATROOM_ID, { role: 'planner', backlogItemId: TEST_TASK_ID }, deps);

    expect(exitSpy).not.toHaveBeenCalled();
    expect(getAllLogOutput()).toContain('Backlog item completed');
    // Strict equality: catches omitted required args (regression: objectContaining
    // let missing fields slip through undetected).
    expect(deps.backend.mutation).toHaveBeenCalledWith(
      expect.anything(),
      {
        sessionId: TEST_SESSION_ID,
        chatroomId: TEST_CHATROOM_ID,
        itemId: TEST_TASK_ID,
      }
    );
  });
});

// ---------------------------------------------------------------------------
// Export / Import Tests
// ---------------------------------------------------------------------------

describe('computeContentHash', () => {
  it('returns consistent SHA-256 hash for the same content', () => {
    const hash1 = computeContentHash('Hello World');
    const hash2 = computeContentHash('Hello World');
    expect(hash1).toBe(hash2);
    expect(hash1).toHaveLength(64); // SHA-256 hex is 64 chars
  });

  it('returns different hashes for different content', () => {
    const hash1 = computeContentHash('Hello');
    const hash2 = computeContentHash('World');
    expect(hash1).not.toBe(hash2);
  });
});

describe('exportBacklog', () => {
  it('creates directory and writes JSON with correct structure', async () => {
    const mockItems = [
      {
        _id: 'item1',
        content: 'Fix login bug',
        status: 'backlog',
        createdBy: 'planner',
        createdAt: 1700000000000,
        complexity: 'low',
        value: 'high',
        priority: 10,
      },
      {
        _id: 'item2',
        content: 'Add dark mode',
        status: 'backlog',
        createdBy: 'user',
        createdAt: 1700001000000,
      },
    ];

    const deps = createMockDeps();
    (deps.backend.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockItems);

    await exportBacklog(TEST_CHATROOM_ID, { role: 'planner', path: '/tmp/export' }, deps);

    expect(exitSpy).not.toHaveBeenCalled();

    // Should create directory
    expect(deps.fs!.mkdir).toHaveBeenCalledWith('/tmp/export', { recursive: true });

    // Should write file
    expect(deps.fs!.writeFile).toHaveBeenCalledTimes(1);
    const writeCall = (deps.fs!.writeFile as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(writeCall[0]).toContain('backlog-export.json');

    // Parse written JSON to verify structure
    const written: BacklogExportFile = JSON.parse(writeCall[1]);
    expect(written.chatroomId).toBe(TEST_CHATROOM_ID);
    expect(written.exportedAt).toBeGreaterThan(0);
    expect(written.items).toHaveLength(2);

    // First item should have all fields
    expect(written.items[0].content).toBe('Fix login bug');
    expect(written.items[0].contentHash).toBe(computeContentHash('Fix login bug'));
    expect(written.items[0].status).toBe('backlog');
    expect(written.items[0].createdBy).toBe('planner');
    expect(written.items[0].createdAt).toBe(1700000000000);
    expect(written.items[0].complexity).toBe('low');
    expect(written.items[0].value).toBe('high');
    expect(written.items[0].priority).toBe(10);

    // Second item should omit optional fields
    expect(written.items[1].content).toBe('Add dark mode');
    expect(written.items[1].complexity).toBeUndefined();
    expect(written.items[1].value).toBeUndefined();
    expect(written.items[1].priority).toBeUndefined();

    // Console output
    const output = getAllLogOutput();
    expect(output).toContain('Exported 2 backlog item(s)');
  });

  it('exports empty backlog successfully', async () => {
    const deps = createMockDeps();
    (deps.backend.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);

    await exportBacklog(TEST_CHATROOM_ID, { role: 'planner', path: '/tmp/export' }, deps);

    expect(exitSpy).not.toHaveBeenCalled();
    const output = getAllLogOutput();
    expect(output).toContain('Exported 0 backlog item(s)');
  });

  it('exits with code 1 when backend query fails', async () => {
    const deps = createMockDeps();
    (deps.backend.query as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('Network error')
    );

    await exportBacklog(TEST_CHATROOM_ID, { role: 'planner', path: '/tmp/export' }, deps);

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(getAllErrorOutput()).toContain('Failed to export backlog items');
  });

  it('uses default path when --path is not provided', async () => {
    const deps = createMockDeps();
    (deps.backend.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);

    await exportBacklog(TEST_CHATROOM_ID, { role: 'planner' }, deps);

    expect(exitSpy).not.toHaveBeenCalled();

    // Should create directory under cwd/.chatroom/exports
    const mkdirCall = (deps.fs!.mkdir as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(mkdirCall[0]).toContain('.chatroom');
    expect(mkdirCall[0]).toContain('exports');

    // Should write file to that default directory
    const writeCall = (deps.fs!.writeFile as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(writeCall[0]).toContain('.chatroom');
    expect(writeCall[0]).toContain('exports');
    expect(writeCall[0]).toContain('backlog-export.json');
  });
});

describe('importBacklog', () => {
  const makeExportFile = (
    items: { content: string; createdBy?: string; createdAt?: number }[],
    overrides?: Partial<BacklogExportFile>
  ): BacklogExportFile => ({
    exportedAt: Date.now(),
    chatroomId: TEST_CHATROOM_ID,
    items: items.map((item) => ({
      contentHash: computeContentHash(item.content),
      content: item.content,
      status: 'backlog',
      createdBy: item.createdBy ?? 'planner',
      createdAt: item.createdAt ?? Date.now(),
    })),
    ...overrides,
  });

  it('reads file, creates new items, and reports counts', async () => {
    const exportData = makeExportFile([
      { content: 'Task A' },
      { content: 'Task B' },
    ]);

    const deps = createMockDeps({
      fs: createMockFsOps({
        readFile: vi.fn().mockResolvedValue(JSON.stringify(exportData)),
      }),
    });
    // No existing items
    (deps.backend.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);
    (deps.backend.mutation as ReturnType<typeof vi.fn>).mockResolvedValue('new-id');

    await importBacklog(TEST_CHATROOM_ID, { role: 'planner', path: '/tmp/export' }, deps);

    expect(exitSpy).not.toHaveBeenCalled();
    expect(deps.backend.mutation).toHaveBeenCalledTimes(2);

    const output = getAllLogOutput();
    expect(output).toContain('Import complete');
    expect(output).toContain('Total items in file: 2');
    expect(output).toContain('Imported: 2');
    expect(output).toContain('Skipped (duplicate): 0');
  });

  it('skips duplicate items based on content hash', async () => {
    const exportData = makeExportFile([
      { content: 'Already exists' },
      { content: 'New task' },
    ]);

    const deps = createMockDeps({
      fs: createMockFsOps({
        readFile: vi.fn().mockResolvedValue(JSON.stringify(exportData)),
      }),
    });
    // Existing item with same content
    (deps.backend.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { _id: 'existing1', content: 'Already exists', status: 'backlog', createdAt: Date.now() },
    ]);
    (deps.backend.mutation as ReturnType<typeof vi.fn>).mockResolvedValue('new-id');

    await importBacklog(TEST_CHATROOM_ID, { role: 'planner', path: '/tmp/export' }, deps);

    expect(exitSpy).not.toHaveBeenCalled();
    // Only 1 mutation call (skipped the duplicate)
    expect(deps.backend.mutation).toHaveBeenCalledTimes(1);

    const output = getAllLogOutput();
    expect(output).toContain('Imported: 1');
    expect(output).toContain('Skipped (duplicate): 1');
  });

  it('shows staleness warning for old exports', async () => {
    const eightDaysAgo = Date.now() - 8 * 24 * 60 * 60 * 1000;
    const exportData = makeExportFile([{ content: 'Old task' }], {
      exportedAt: eightDaysAgo,
    });

    const deps = createMockDeps({
      fs: createMockFsOps({
        readFile: vi.fn().mockResolvedValue(JSON.stringify(exportData)),
      }),
    });
    (deps.backend.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);
    (deps.backend.mutation as ReturnType<typeof vi.fn>).mockResolvedValue('new-id');

    await importBacklog(TEST_CHATROOM_ID, { role: 'planner', path: '/tmp/export' }, deps);

    expect(exitSpy).not.toHaveBeenCalled();
    const output = getAllLogOutput();
    expect(output).toContain('days old and may be stale');
  });

  it('does not show staleness warning for recent exports', async () => {
    const exportData = makeExportFile([{ content: 'Recent task' }], {
      exportedAt: Date.now() - 1000, // 1 second ago
    });

    const deps = createMockDeps({
      fs: createMockFsOps({
        readFile: vi.fn().mockResolvedValue(JSON.stringify(exportData)),
      }),
    });
    (deps.backend.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);
    (deps.backend.mutation as ReturnType<typeof vi.fn>).mockResolvedValue('new-id');

    await importBacklog(TEST_CHATROOM_ID, { role: 'planner', path: '/tmp/export' }, deps);

    const output = getAllLogOutput();
    expect(output).not.toContain('stale');
  });

  it('idempotent: importing same file twice creates items only once', async () => {
    const exportData = makeExportFile([
      { content: 'Task X' },
      { content: 'Task Y' },
    ]);

    // First import — no existing items
    const deps1 = createMockDeps({
      fs: createMockFsOps({
        readFile: vi.fn().mockResolvedValue(JSON.stringify(exportData)),
      }),
    });
    (deps1.backend.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);
    (deps1.backend.mutation as ReturnType<typeof vi.fn>).mockResolvedValue('new-id');

    await importBacklog(TEST_CHATROOM_ID, { role: 'planner', path: '/tmp/export' }, deps1);
    expect(deps1.backend.mutation).toHaveBeenCalledTimes(2);

    // Second import — existing items match
    const deps2 = createMockDeps({
      fs: createMockFsOps({
        readFile: vi.fn().mockResolvedValue(JSON.stringify(exportData)),
      }),
    });
    (deps2.backend.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { _id: 'x1', content: 'Task X', status: 'backlog', createdAt: Date.now() },
      { _id: 'x2', content: 'Task Y', status: 'backlog', createdAt: Date.now() },
    ]);

    await importBacklog(TEST_CHATROOM_ID, { role: 'planner', path: '/tmp/export' }, deps2);

    // No mutations on second import
    expect(deps2.backend.mutation).not.toHaveBeenCalled();

    const output = getAllLogOutput();
    expect(output).toContain('Skipped (duplicate): 2');
  });

  it('handles duplicate items within the same export file', async () => {
    const exportData = makeExportFile([
      { content: 'Same content' },
      { content: 'Same content' },
    ]);

    const deps = createMockDeps({
      fs: createMockFsOps({
        readFile: vi.fn().mockResolvedValue(JSON.stringify(exportData)),
      }),
    });
    (deps.backend.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);
    (deps.backend.mutation as ReturnType<typeof vi.fn>).mockResolvedValue('new-id');

    await importBacklog(TEST_CHATROOM_ID, { role: 'planner', path: '/tmp/export' }, deps);

    // Should only create one item — second is a duplicate within the same file
    expect(deps.backend.mutation).toHaveBeenCalledTimes(1);

    const output = getAllLogOutput();
    expect(output).toContain('Imported: 1');
    expect(output).toContain('Skipped (duplicate): 1');
  });

  it('exits with code 1 when file read fails', async () => {
    const deps = createMockDeps({
      fs: createMockFsOps({
        readFile: vi.fn().mockRejectedValue(new Error('ENOENT: no such file')),
      }),
    });

    await importBacklog(TEST_CHATROOM_ID, { role: 'planner', path: '/tmp/nonexistent' }, deps);

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(getAllErrorOutput()).toContain('Failed to import backlog items');
  });

  it('uses default path when --path is not provided', async () => {
    const exportData = makeExportFile([{ content: 'Default path task' }]);

    const deps = createMockDeps({
      fs: createMockFsOps({
        readFile: vi.fn().mockResolvedValue(JSON.stringify(exportData)),
      }),
    });
    (deps.backend.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);
    (deps.backend.mutation as ReturnType<typeof vi.fn>).mockResolvedValue('new-id');

    await importBacklog(TEST_CHATROOM_ID, { role: 'planner' }, deps);

    expect(exitSpy).not.toHaveBeenCalled();

    // Should read from cwd/.chatroom/exports/backlog-export.json
    const readCall = (deps.fs!.readFile as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(readCall[0]).toContain('.chatroom');
    expect(readCall[0]).toContain('exports');
    expect(readCall[0]).toContain('backlog-export.json');
  });
});

// ---------------------------------------------------------------------------
// updateBacklog Tests
// ---------------------------------------------------------------------------

describe('updateBacklog', () => {
  it('calls updateBacklogItem mutation with trimmed content', async () => {
    const deps = createMockDeps();
    (deps.backend.mutation as ReturnType<typeof vi.fn>).mockResolvedValue({ success: true });

    await updateBacklog(
      TEST_CHATROOM_ID,
      { role: 'planner', backlogItemId: TEST_TASK_ID, content: '  Updated content  ' },
      deps
    );

    expect(exitSpy).not.toHaveBeenCalled();
    // Use strict equality (not objectContaining) to ensure no required fields
    // are silently omitted — the prior objectContaining form let a missing
    // chatroomId slip through undetected.
    expect(deps.backend.mutation).toHaveBeenCalledWith(
      expect.anything(),
      {
        sessionId: TEST_SESSION_ID,
        chatroomId: TEST_CHATROOM_ID,
        itemId: TEST_TASK_ID,
        content: 'Updated content',
      }
    );
    expect(getAllLogOutput()).toContain('Backlog item content updated');
  });

  it('exits with code 1 when backlogItemId is missing', async () => {
    const deps = createMockDeps();

    await updateBacklog(TEST_CHATROOM_ID, { role: 'planner', backlogItemId: '', content: 'some content' }, deps);

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(deps.backend.mutation).not.toHaveBeenCalled();
    expect(getAllErrorOutput()).toContain('Backlog item ID is required');
  });

  it('exits with code 1 when content is empty/whitespace', async () => {
    const deps = createMockDeps();

    await updateBacklog(
      TEST_CHATROOM_ID,
      { role: 'planner', backlogItemId: TEST_TASK_ID, content: '   ' },
      deps
    );

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(deps.backend.mutation).not.toHaveBeenCalled();
    expect(getAllErrorOutput()).toContain('Content is empty');
  });
});

// ---------------------------------------------------------------------------
// closeBacklog Tests
// ---------------------------------------------------------------------------

describe('closeBacklog', () => {
  it('calls closeBacklogItem mutation with reason', async () => {
    const deps = createMockDeps();
    (deps.backend.mutation as ReturnType<typeof vi.fn>).mockResolvedValue({ success: true });

    await closeBacklog(
      TEST_CHATROOM_ID,
      { role: 'planner', backlogItemId: TEST_TASK_ID, reason: 'duplicate of item XYZ' },
      deps
    );

    expect(exitSpy).not.toHaveBeenCalled();
    // Strict equality: catches omitted required args like chatroomId
    expect(deps.backend.mutation).toHaveBeenCalledWith(
      expect.anything(),
      {
        sessionId: TEST_SESSION_ID,
        chatroomId: TEST_CHATROOM_ID,
        itemId: TEST_TASK_ID,
        reason: 'duplicate of item XYZ',
      }
    );
    expect(getAllLogOutput()).toContain('Backlog item closed');
  });

  it('exits with code 1 when reason is missing', async () => {
    const deps = createMockDeps();

    await closeBacklog(
      TEST_CHATROOM_ID,
      { role: 'planner', backlogItemId: TEST_TASK_ID, reason: '' },
      deps
    );

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(deps.backend.mutation).not.toHaveBeenCalled();
    expect(getAllErrorOutput()).toContain('Reason is required');
  });

  it('exits with code 1 when backlog item ID is missing', async () => {
    const deps = createMockDeps();

    await closeBacklog(
      TEST_CHATROOM_ID,
      { role: 'planner', backlogItemId: '', reason: 'done' },
      deps
    );

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(deps.backend.mutation).not.toHaveBeenCalled();
    expect(getAllErrorOutput()).toContain('Backlog item ID is required');
  });

  it('trims reason before sending to mutation', async () => {
    const deps = createMockDeps();
    (deps.backend.mutation as ReturnType<typeof vi.fn>).mockResolvedValue({ success: true });

    await closeBacklog(
      TEST_CHATROOM_ID,
      { role: 'planner', backlogItemId: TEST_TASK_ID, reason: '  trimmed reason  ' },
      deps
    );

    expect(exitSpy).not.toHaveBeenCalled();
    // Strict equality: include all required mutation args, not just the
    // trimmed field — objectContaining would silently miss omitted fields.
    expect(deps.backend.mutation).toHaveBeenCalledWith(
      expect.anything(),
      {
        sessionId: TEST_SESSION_ID,
        chatroomId: TEST_CHATROOM_ID,
        itemId: TEST_TASK_ID,
        reason: 'trimmed reason',
      }
    );
    expect(getAllLogOutput()).toContain('Reason: trimmed reason');
  });
});
