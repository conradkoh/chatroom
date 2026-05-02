import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { DirectHarnessPanel } from './DirectHarnessPanel';

// Mock feature flag as OFF for this test file
vi.mock('@workspace/backend/config/featureFlags', () => ({
  featureFlags: { directHarnessWorkers: false },
}));

vi.mock('convex-helpers/react/sessions', () => ({
  useSessionQuery: vi.fn().mockReturnValue(undefined),
  useSessionMutation: vi.fn().mockReturnValue(vi.fn()),
}));

vi.mock('@workspace/backend/convex/_generated/api', () => ({
  api: {
    workspaces: { listWorkspacesForChatroom: 'mock' },
    chatroom: {
      directHarness: {
        sessions: { listSessionsByWorkspace: 'mock', openSession: 'mock' },
        capabilities: { getMachineRegistry: 'mock' },
      },
    },
  },
}));

describe('DirectHarnessPanel — flag off', () => {
  it('returns null when directHarnessWorkers is false', () => {
    const { container } = render(<DirectHarnessPanel chatroomId="room-1" />);
    expect(container.firstChild).toBeNull();
  });
});
