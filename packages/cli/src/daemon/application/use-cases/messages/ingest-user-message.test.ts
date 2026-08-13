import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import { ingestUserMessage } from './ingest-user-message.js';
import { openDatabase } from '../../../infrastructure/persistence/open-database.js';
import { listTaskReadModelsForChatroomRole } from '../../../infrastructure/persistence/read-models/tasks.js';

describe('ingestUserMessage', () => {
  it('stores a planner task, appends projection event, and emits local delivery', async () => {
    const db = openDatabase(join(mkdtempSync(join(tmpdir(), 'p7-')), 'events.sqlite'));
    const appendEvent = vi.fn();
    const emitOrchestrationEvent = vi.fn();
    process.env.DAEMON_ORCHESTRATION_P3_LOCAL_DELIVERY = '1';
    try {
      const result = await ingestUserMessage(
        { db, machineId: 'machine', sessionId: 'session', appendEvent, emitOrchestrationEvent, getAgentHarness: async () => 'opencode' },
        { chatroomId: 'room', messageId: 'message', content: 'hello', senderRole: 'user', entryPointRole: 'planner' }
      );
      expect(listTaskReadModelsForChatroomRole(db, 'room', 'planner')[0]).toMatchObject({ taskId: result.newTaskId, taskContent: 'hello', status: 'pending' });
      expect(appendEvent).toHaveBeenCalledWith(expect.objectContaining({ type: 'user-message.received', newTaskId: result.newTaskId }));
      expect(emitOrchestrationEvent).toHaveBeenCalledWith({ chatroomId: 'room', role: 'planner', taskId: result.newTaskId, source: 'user-message' });
    } finally {
      delete process.env.DAEMON_ORCHESTRATION_P3_LOCAL_DELIVERY;
      db.close();
    }
  });
});
