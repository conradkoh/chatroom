import { beforeEach, describe, expect, it, vi } from 'vitest';
import { dispatchAgenticQueryInboundEvent } from '../agentic-query-inbound-registry.js';
import { startAgenticQuerySubscriptions } from './start-subscriptions.js';
import { drainPendingAgenticQueryMessages } from './prompt-drain.js';
import { processPendingAgenticQuerySessions } from './session-processor.js';

vi.mock('./prompt-drain.js', () => ({
  drainPendingAgenticQueryMessages: vi.fn(async () => undefined),
}));
vi.mock('./session-processor.js', () => ({
  processPendingAgenticQuerySessions: vi.fn(async () => undefined),
}));

const drain = vi.mocked(drainPendingAgenticQueryMessages);
const process = vi.mocked(processPendingAgenticQuerySessions);

describe('startAgenticQuerySubscriptions', () => {
  beforeEach(() => {
    drain.mockClear();
    process.mockClear();
  });

  it('drains prompts on prompt events', async () => {
    const handles = startAgenticQuerySubscriptions({} as never, new Map(), new Map());
    await dispatchAgenticQueryInboundEvent({ type: 'agentic-query.prompt' } as never);
    expect(drain).toHaveBeenCalledOnce();
    expect(process).not.toHaveBeenCalled();
    handles.stop();
  });

  it('opens sessions then drains prompts on session-opened events', async () => {
    const order: string[] = [];
    process.mockImplementationOnce(async () => { order.push('process'); });
    drain.mockImplementationOnce(async () => { order.push('drain'); });
    const handles = startAgenticQuerySubscriptions({} as never, new Map(), new Map());
    await dispatchAgenticQueryInboundEvent({ type: 'agentic-query.session-opened' } as never);
    expect(order).toEqual(['process', 'drain']);
    handles.stop();
  });
});
