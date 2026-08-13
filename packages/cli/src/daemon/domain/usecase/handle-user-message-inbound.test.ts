import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { openDatabase } from '../../infrastructure/persistence/open-database.js';
import { handleUserMessageInbound } from './handle-user-message-inbound.js';

describe('handleUserMessageInbound', () => {
  it('ingests a user message with content', async () => {
    const db = openDatabase(join(mkdtempSync(join(tmpdir(), 'p7-handler-')), 'db.sqlite'));
    const appendEvent = vi.fn();
    try {
      await handleUserMessageInbound({ db, machineId: 'm', sessionId: 's', appendEvent, emitOrchestrationEvent: vi.fn(), query: vi.fn(), getEntryPointRole: async () => 'planner', getAgentHarness: async () => 'opencode' }, { chatroomId: 'room', messageId: 'msg', content: 'hello', senderRole: 'user' });
      expect(appendEvent).toHaveBeenCalledWith(expect.objectContaining({ type: 'user-message.received', content: 'hello' }));
    } finally { db.close(); }
  });
  it('skips missing content and non-user messages', async () => {
    const db = openDatabase(join(mkdtempSync(join(tmpdir(), 'p7-handler-')), 'db.sqlite'));
    const appendEvent = vi.fn();
    try {
      const deps = { db, machineId: 'm', sessionId: 's', appendEvent, emitOrchestrationEvent: vi.fn(), query: vi.fn(), getEntryPointRole: async () => 'planner', getAgentHarness: async () => 'opencode' };
      await handleUserMessageInbound(deps, { chatroomId: 'room', messageId: 'a' });
      await handleUserMessageInbound(deps, { chatroomId: 'room', messageId: 'b', content: 'no', senderRole: 'builder' });
      expect(appendEvent).not.toHaveBeenCalled();
    } finally { db.close(); }
  });
});
