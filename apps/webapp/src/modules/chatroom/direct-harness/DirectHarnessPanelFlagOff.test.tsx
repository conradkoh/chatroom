import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { DirectHarnessPanel } from './DirectHarnessPanel';

// Mock feature flag as OFF for this test file — panel should return null
vi.mock('@workspace/backend/config/featureFlags', () => ({
  featureFlags: { directHarnessWorkers: false },
}));

// Panel reads NEXT_PUBLIC_DIRECT_HARNESS_ENABLED, not the backend flag directly
process.env.NEXT_PUBLIC_DIRECT_HARNESS_ENABLED = 'false';

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
