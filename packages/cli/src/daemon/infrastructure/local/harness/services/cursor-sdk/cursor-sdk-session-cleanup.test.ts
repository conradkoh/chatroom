import { describe, expect, it, vi } from 'vitest';

import { closeCursorAgentOnFailure } from './cursor-sdk-session-cleanup.js';

describe('closeCursorAgentOnFailure', () => {
  it('closes the agent on unrecoverable errors', () => {
    const close = vi.fn();
    const session = {
      agentClosed: false,
      preserveForResume: false,
      aborted: false,
    };

    closeCursorAgentOnFailure({ close } as never, session, 1);

    expect(close).toHaveBeenCalledOnce();
    expect(session.agentClosed).toBe(true);
  });

  it('skips close on graceful natural exit', () => {
    const close = vi.fn();
    const session = {
      agentClosed: false,
      preserveForResume: false,
      aborted: false,
    };

    closeCursorAgentOnFailure({ close } as never, session, 0);

    expect(close).not.toHaveBeenCalled();
    expect(session.agentClosed).toBe(false);
  });

  it('skips close when preserveForResume is set', () => {
    const close = vi.fn();
    const session = {
      agentClosed: false,
      preserveForResume: true,
      aborted: true,
    };

    closeCursorAgentOnFailure({ close } as never, session, 1);

    expect(close).not.toHaveBeenCalled();
  });

  it('force closes even when exit code is 0', () => {
    const close = vi.fn();
    const session = {
      agentClosed: false,
      preserveForResume: false,
      aborted: false,
    };

    closeCursorAgentOnFailure({ close } as never, session, 0, true);

    expect(close).toHaveBeenCalledOnce();
    expect(session.agentClosed).toBe(true);
  });
});
