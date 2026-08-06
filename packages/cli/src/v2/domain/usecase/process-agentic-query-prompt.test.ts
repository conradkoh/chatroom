import { describe, expect, it, vi } from 'vitest';

import {
  processAgenticQueryInbound,
  type ProcessAgenticQueryInboundDeps,
} from './process-agentic-query-prompt.js';

describe('processAgenticQueryInbound', () => {
  it('dispatches agentic-query.session-opened events to port', async () => {
    const dispatchInbound = vi.fn().mockResolvedValue(undefined);
    const deps: ProcessAgenticQueryInboundDeps = { dispatchInbound };
    const event = { type: 'agentic-query.session-opened' as const, sessionId: 'run_1' };

    await processAgenticQueryInbound(deps, event);

    expect(dispatchInbound).toHaveBeenCalledOnce();
    expect(dispatchInbound).toHaveBeenCalledWith(event);
  });

  it('dispatches agentic-query.prompt events to port', async () => {
    const dispatchInbound = vi.fn().mockResolvedValue(undefined);
    const deps: ProcessAgenticQueryInboundDeps = { dispatchInbound };
    const event = { type: 'agentic-query.prompt' as const, sessionId: 'run_1' };

    await processAgenticQueryInbound(deps, event);

    expect(dispatchInbound).toHaveBeenCalledOnce();
    expect(dispatchInbound).toHaveBeenCalledWith(event);
  });
});
