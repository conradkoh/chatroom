import type { ConvexClient } from 'convex/browser';
import type { SessionId } from 'convex-helpers/server/sessions';
import { describe, expect, it, vi } from 'vitest';

import { startAgenticQueryPromptSubscriber } from './agentic-query-prompt.js';
import { startAgenticQuerySessionSubscriber } from './agentic-query-session.js';
import { startEnhancerJobSubscriber } from './enhancer-job.js';
import type { InboundEvent } from '../../../domain/entities/inbound-event.js';
import type { AgenticQueryInboundEvent } from '../../../domain/usecase/handle-agentic-query-inbound.js';
import type { EnhancerInboundEvent } from '../../../domain/usecase/handle-enhancer-inbound.js';
import { createDefaultEventRouterDeps } from '../../../entry/default-router-deps.js';
import { routeInboundEvent } from '../../../entry/event-router.js';
import { startAllSubscribers } from '../../../entry/subscriber-registry.js';

const RUN_ID = 'aq_run_1';
const JOB_ID = 'enhancer_job_1';
const SESSION_ID = 'session-test' as SessionId;
const MACHINE_ID = 'machine-test';

function createMockWsClient() {
  const callbacks: ((result: unknown) => void)[] = [];

  const wsClient = {
    onUpdate: vi.fn((_query, _args, onUpdate) => {
      callbacks.push(onUpdate);
      return vi.fn();
    }),
    query: vi.fn().mockResolvedValue(null),
  } as unknown as ConvexClient;

  return {
    wsClient,
    emitUpdate: (result: unknown) => {
      for (const callback of callbacks) {
        callback(result);
      }
    },
  };
}

describe('agentic-query and enhancer v2 subscribers', () => {
  it('agentic-query session subscriber emits agentic-query.session-opened', async () => {
    const events: InboundEvent[] = [];
    const { wsClient, emitUpdate } = createMockWsClient();

    const handle = startAgenticQuerySessionSubscriber(
      { wsClient, sessionId: SESSION_ID, machineId: MACHINE_ID },
      (event) => events.push(event)
    );

    emitUpdate([{ runId: RUN_ID }]);
    await handle.stop();

    expect(events).toContainEqual({
      type: 'agentic-query.session-opened',
      sessionId: RUN_ID,
    });
  });

  it('agentic-query prompt subscriber emits agentic-query.prompt per runId with messages', async () => {
    const events: InboundEvent[] = [];
    const { wsClient, emitUpdate } = createMockWsClient();

    const handle = startAgenticQueryPromptSubscriber(
      { wsClient, sessionId: SESSION_ID, machineId: MACHINE_ID },
      (event) => events.push(event)
    );

    emitUpdate({ messages: [{ runId: RUN_ID, content: 'hello' }] });
    await handle.stop();

    expect(events).toContainEqual({
      type: 'agentic-query.prompt',
      sessionId: RUN_ID,
    });
  });

  it('enhancer subscriber emits enhancer.job-assigned with jobId', async () => {
    const events: InboundEvent[] = [];
    const { wsClient, emitUpdate } = createMockWsClient();

    const handle = startEnhancerJobSubscriber(
      { wsClient, sessionId: SESSION_ID, machineId: MACHINE_ID },
      (event) => events.push(event)
    );

    emitUpdate([{ jobId: JOB_ID }]);
    await handle.stop();

    expect(events).toContainEqual({
      type: 'enhancer.job-assigned',
      jobId: JOB_ID,
    });
  });

  it('registry routes agentic-query and enhancer events to handlers', async () => {
    const agenticHandled: AgenticQueryInboundEvent[] = [];
    const enhancerHandled: EnhancerInboundEvent[] = [];
    const { wsClient, emitUpdate } = createMockWsClient();

    const registry = startAllSubscribers({
      wsClient,
      sessionId: SESSION_ID,
      machineId: MACHINE_ID,
      router: {
        assignedTask: {},
        directHarness: {},
        command: {},
        workspaceGit: {},
        file: {},
        agenticQuery: {
          deliverInbound: async (event) => {
            agenticHandled.push(event);
          },
        },
        enhancer: {
          onEnhancerEvent: async (event) => {
            enhancerHandled.push(event);
          },
        },
      },
    });

    emitUpdate([{ runId: RUN_ID }]);
    emitUpdate([{ jobId: JOB_ID }]);
    await registry.stopAll();

    expect(agenticHandled).toContainEqual({
      type: 'agentic-query.session-opened',
      sessionId: RUN_ID,
    });
    expect(enhancerHandled).toContainEqual({
      type: 'enhancer.job-assigned',
      jobId: JOB_ID,
    });
  });

  it('event router dispatches agentic-query and enhancer events to handlers', async () => {
    const agenticHandled: AgenticQueryInboundEvent[] = [];
    const enhancerHandled: EnhancerInboundEvent[] = [];

    await routeInboundEvent(
      {
        assignedTask: {},
        directHarness: {},
        command: {},
        workspaceGit: {},
        file: {},
        agenticQuery: {
          deliverInbound: async (event) => {
            agenticHandled.push(event);
          },
        },
        enhancer: {
          onEnhancerEvent: async (event) => {
            enhancerHandled.push(event);
          },
        },
      },
      { type: 'enhancer.job-assigned', jobId: JOB_ID }
    );

    expect(agenticHandled).toEqual([]);
    expect(enhancerHandled).toEqual([{ type: 'enhancer.job-assigned', jobId: JOB_ID }]);
  });

  it('default router deps provide deliverInbound hook for agentic query', () => {
    const deps = createDefaultEventRouterDeps();
    expect(deps.agenticQuery.deliverInbound).toBeTypeOf('function');
  });
});
