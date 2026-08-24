import { describe, expect, test, vi } from 'vitest';

import { routeInboundEvent } from './event-router.js';
import type { InboundEvent } from '../domain/entities/inbound-event.js';
import type { AgenticQueryInboundEvent } from '../domain/usecase/handle-agentic-query-inbound.js';
import type { CommandInboundEvent } from '../domain/usecase/handle-command-inbound.js';
import type { DirectHarnessInboundEvent } from '../domain/usecase/handle-direct-harness-inbound.js';
import type { EnhancerInboundEvent } from '../domain/usecase/handle-enhancer-inbound.js';
import type { FileInboundEvent } from '../domain/usecase/handle-file-inbound.js';
import type { WorkspaceGitInboundEvent } from '../domain/usecase/handle-workspace-git-inbound.js';

const routerDeps = {
  directHarness: {} as {
    deliverInbound?: (event: DirectHarnessInboundEvent) => Promise<void>;
  },
  command: {} as { deliverInbound?: (event: CommandInboundEvent) => Promise<void> },
  workspaceGit: {} as {
    deliverInbound?: (event: WorkspaceGitInboundEvent) => Promise<void>;
  },
  file: {} as { deliverInbound?: (event: FileInboundEvent) => Promise<void> },
  agenticQuery: {} as {
    deliverInbound?: (event: AgenticQueryInboundEvent) => Promise<void>;
  },
  enhancer: {} as { deliverInbound?: (event: EnhancerInboundEvent) => Promise<void> },
};

describe('routeInboundEvent', () => {
  test('dispatches direct-harness.session-opened to handler', async () => {
    const deliverInbound = vi.fn().mockResolvedValue(undefined);
    const event: DirectHarnessInboundEvent = {
      type: 'direct-harness.session-opened',
      harnessSessionId: 'harness_1',
    };

    await routeInboundEvent({ ...routerDeps, directHarness: { deliverInbound } }, event);

    expect(deliverInbound).toHaveBeenCalledWith(event);
  });

  test('dispatches direct-harness.prompt to handler', async () => {
    const deliverInbound = vi.fn().mockResolvedValue(undefined);
    const event: DirectHarnessInboundEvent = {
      type: 'direct-harness.prompt',
      harnessSessionId: 'harness_1',
    };

    await routeInboundEvent({ ...routerDeps, directHarness: { deliverInbound } }, event);

    expect(deliverInbound).toHaveBeenCalledWith(event);
  });

  test('dispatches direct-harness.command to handler', async () => {
    const deliverInbound = vi.fn().mockResolvedValue(undefined);
    const event: DirectHarnessInboundEvent = {
      type: 'direct-harness.command',
      commandId: 'cmd_1',
    };

    await routeInboundEvent({ ...routerDeps, directHarness: { deliverInbound } }, event);

    expect(deliverInbound).toHaveBeenCalledWith(event);
  });

  test('dispatches command.received to handler', async () => {
    const deliverInbound = vi.fn().mockResolvedValue(undefined);
    const event: CommandInboundEvent = {
      type: 'command.received',
      commandId: 'cmd_1',
      claimedCommand: {
        commandId: 'cmd_1',
        machineId: 'm',
        deadline: Date.now() + 1000,
        timestamp: Date.now(),
        type: 'daemon.ping',
      },
    };

    await routeInboundEvent({ ...routerDeps, command: { deliverInbound } }, event);

    expect(deliverInbound).toHaveBeenCalledWith(event);
  });

  test('dispatches command-run.updated to handler', async () => {
    const deliverInbound = vi.fn().mockResolvedValue(undefined);
    const event: CommandInboundEvent = {
      type: 'command-run.updated',
      runId: 'run_1',
    };

    await routeInboundEvent({ ...routerDeps, command: { deliverInbound } }, event);

    expect(deliverInbound).toHaveBeenCalledWith(event);
  });

  test('dispatches workspace.list-changed to handler', async () => {
    const deliverInbound = vi.fn().mockResolvedValue(undefined);
    const event: WorkspaceGitInboundEvent = {
      type: 'workspace.list-changed',
      machineId: 'machine_1',
    };

    await routeInboundEvent({ ...routerDeps, workspaceGit: { deliverInbound } }, event);

    expect(deliverInbound).toHaveBeenCalledWith(event);
  });

  test('dispatches git.request to handler', async () => {
    const deliverInbound = vi.fn().mockResolvedValue(undefined);
    const event: WorkspaceGitInboundEvent = {
      type: 'git.request',
      requestId: 'req_1',
    };

    await routeInboundEvent({ ...routerDeps, workspaceGit: { deliverInbound } }, event);

    expect(deliverInbound).toHaveBeenCalledWith(event);
  });

  test('dispatches file-tree.request to handler', async () => {
    const deliverInbound = vi.fn().mockResolvedValue(undefined);
    const event: FileInboundEvent = {
      type: 'file-tree.request',
      requestId: 'req_1',
    };

    await routeInboundEvent({ ...routerDeps, file: { deliverInbound } }, event);

    expect(deliverInbound).toHaveBeenCalledWith(event);
  });

  test('dispatches file-content.request to handler', async () => {
    const deliverInbound = vi.fn().mockResolvedValue(undefined);
    const event: FileInboundEvent = {
      type: 'file-content.request',
      requestId: 'req_2',
    };

    await routeInboundEvent({ ...routerDeps, file: { deliverInbound } }, event);

    expect(deliverInbound).toHaveBeenCalledWith(event);
  });

  test('dispatches file-write.request to handler', async () => {
    const deliverInbound = vi.fn().mockResolvedValue(undefined);
    const event: FileInboundEvent = {
      type: 'file-write.request',
      requestId: 'req_3',
    };

    await routeInboundEvent({ ...routerDeps, file: { deliverInbound } }, event);

    expect(deliverInbound).toHaveBeenCalledWith(event);
  });

  test('dispatches agentic-query.session-opened to handler', async () => {
    const deliverInbound = vi.fn().mockResolvedValue(undefined);
    const event: AgenticQueryInboundEvent = {
      type: 'agentic-query.session-opened',
      sessionId: 'run_1',
    };

    await routeInboundEvent({ ...routerDeps, agenticQuery: { deliverInbound } }, event);

    expect(deliverInbound).toHaveBeenCalledWith(event);
  });

  test('dispatches agentic-query.prompt to handler', async () => {
    const deliverInbound = vi.fn().mockResolvedValue(undefined);
    const event: AgenticQueryInboundEvent = {
      type: 'agentic-query.prompt',
      sessionId: 'run_1',
    };

    await routeInboundEvent({ ...routerDeps, agenticQuery: { deliverInbound } }, event);

    expect(deliverInbound).toHaveBeenCalledWith(event);
  });

  test('dispatches enhancer.job-assigned to handler', async () => {
    const deliverInbound = vi.fn().mockResolvedValue(undefined);
    const event: EnhancerInboundEvent = {
      type: 'enhancer.job-assigned',
      jobId: 'job_1',
    };

    await routeInboundEvent({ ...routerDeps, enhancer: { deliverInbound } }, event);

    expect(deliverInbound).toHaveBeenCalledWith(event);
  });

  test('ignores unhandled event types', async () => {
    const deliverDirectHarnessInbound = vi.fn().mockResolvedValue(undefined);
    const deliverInbound = vi.fn().mockResolvedValue(undefined);
    const deliverWorkspaceGitInbound = vi.fn().mockResolvedValue(undefined);
    const deliverFileInbound = vi.fn().mockResolvedValue(undefined);
    const deliverAgenticQueryInbound = vi.fn().mockResolvedValue(undefined);
    const deliverEnhancerInbound = vi.fn().mockResolvedValue(undefined);

    await routeInboundEvent(
      {
        directHarness: { deliverInbound: deliverDirectHarnessInbound },
        command: { deliverInbound },
        workspaceGit: { deliverInbound: deliverWorkspaceGitInbound },
        file: { deliverInbound: deliverFileInbound },
        agenticQuery: { deliverInbound: deliverAgenticQueryInbound },
        enhancer: { deliverInbound: deliverEnhancerInbound },
      },
      { type: 'not-a-real-type' } as unknown as InboundEvent
    );

    expect(deliverDirectHarnessInbound).not.toHaveBeenCalled();
    expect(deliverInbound).not.toHaveBeenCalled();
    expect(deliverWorkspaceGitInbound).not.toHaveBeenCalled();
    expect(deliverFileInbound).not.toHaveBeenCalled();
    expect(deliverAgenticQueryInbound).not.toHaveBeenCalled();
    expect(deliverEnhancerInbound).not.toHaveBeenCalled();
  });
});
