import { describe, expect, test, vi } from 'vitest';

import { createLocalHandoffGateway } from './local-handoff-gateway.js';
import { requestLocalDaemon } from '../../commands/diagnostics/local-daemon.js';

vi.mock('../../commands/diagnostics/local-daemon.js', () => ({
  requestLocalDaemon: vi.fn(),
}));
vi.mock('../../daemon/entry/resolve-local-web-port.js', () => ({
  resolveLocalWebPort: vi.fn(() => 18765),
}));

describe('createLocalHandoffGateway', () => {
  test('reports an explicit error when the daemon gateway is unavailable', async () => {
    vi.mocked(requestLocalDaemon).mockRejectedValueOnce(new Error('connect ECONNREFUSED'));

    await expect(
      createLocalHandoffGateway().handoff({
        sessionId: 'session-1',
        chatroomId: 'room-1',
        senderRole: 'planner',
        content: 'handoff',
        targetRole: 'user',
      })
    ).rejects.toThrow(
      'CLI gateway unavailable. Start the Chatroom daemon and retry. connect ECONNREFUSED'
    );
  });
});
