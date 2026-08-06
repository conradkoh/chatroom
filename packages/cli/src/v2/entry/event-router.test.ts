import { describe, expect, test, vi } from 'vitest';

import { routeInboundEvent } from './event-router.js';
import type { InboundEvent } from '../domain/entities/inbound-event.js';
import type { AgenticQueryInboundEvent } from '../domain/usecase/handle-agentic-query-inbound.js';
import type { AssignedTaskInboundEvent } from '../domain/usecase/handle-assigned-task-inbound.js';
import type { CommandInboundEvent } from '../domain/usecase/handle-command-inbound.js';
import type { DirectHarnessInboundEvent } from '../domain/usecase/handle-direct-harness-inbound.js';
import type { EnhancerInboundEvent } from '../domain/usecase/handle-enhancer-inbound.js';
import type { FileInboundEvent } from '../domain/usecase/handle-file-inbound.js';
import type { WorkspaceGitInboundEvent } from '../domain/usecase/handle-workspace-git-inbound.js';

const routerDeps = {
  assignedTask: {} as { deliverInbound?: (event: AssignedTaskInboundEvent) => Promise<void> },
  directHarness: {} as {
    onDirectHarnessEvent?: (event: DirectHarnessInboundEvent) => Promise<void>;
  },
  command: {} as { onCommandEvent?: (event: CommandInboundEvent) => Promise<void> },
  workspaceGit: {} as {
    onWorkspaceGitEvent?: (event: WorkspaceGitInboundEvent) => Promise<void>;
  },
  file: {} as { onFileEvent?: (event: FileInboundEvent) => Promise<void> },
  agenticQuery: {} as {
    onAgenticQueryEvent?: (event: AgenticQueryInboundEvent) => Promise<void>;
  },
  enhancer: {} as { onEnhancerEvent?: (event: EnhancerInboundEvent) => Promise<void> },
};

describe('routeInboundEvent', () => {
  test('dispatches assigned-task.signal to handler', async () => {
    const deliverInbound = vi.fn().mockResolvedValue(undefined);
    const event: AssignedTaskInboundEvent = {
      type: 'assigned-task.signal',
      taskId: 'task_1',
      role: 'builder',
    };

    await routeInboundEvent({ ...routerDeps, assignedTask: { deliverInbound } }, event);

    expect(deliverInbound).toHaveBeenCalledWith(event);
  });

  test('dispatches assigned-task.presence to handler', async () => {
    const deliverInbound = vi.fn().mockResolvedValue(undefined);
    const event: AssignedTaskInboundEvent = {
      type: 'assigned-task.presence',
      taskId: 'task_1',
      role: 'planner',
    };

    await routeInboundEvent({ ...routerDeps, assignedTask: { deliverInbound } }, event);

    expect(deliverInbound).toHaveBeenCalledWith(event);
  });

  test('dispatches direct-harness.session-opened to handler', async () => {
    const onDirectHarnessEvent = vi.fn().mockResolvedValue(undefined);
    const event: DirectHarnessInboundEvent = {
      type: 'direct-harness.session-opened',
      harnessSessionId: 'harness_1',
    };

    await routeInboundEvent({ ...routerDeps, directHarness: { onDirectHarnessEvent } }, event);

    expect(onDirectHarnessEvent).toHaveBeenCalledWith(event);
  });

  test('dispatches direct-harness.prompt to handler', async () => {
    const onDirectHarnessEvent = vi.fn().mockResolvedValue(undefined);
    const event: DirectHarnessInboundEvent = {
      type: 'direct-harness.prompt',
      harnessSessionId: 'harness_1',
    };

    await routeInboundEvent({ ...routerDeps, directHarness: { onDirectHarnessEvent } }, event);

    expect(onDirectHarnessEvent).toHaveBeenCalledWith(event);
  });

  test('dispatches direct-harness.command to handler', async () => {
    const onDirectHarnessEvent = vi.fn().mockResolvedValue(undefined);
    const event: DirectHarnessInboundEvent = {
      type: 'direct-harness.command',
      commandId: 'cmd_1',
    };

    await routeInboundEvent({ ...routerDeps, directHarness: { onDirectHarnessEvent } }, event);

    expect(onDirectHarnessEvent).toHaveBeenCalledWith(event);
  });

  test('dispatches command.received to handler', async () => {
    const onCommandEvent = vi.fn().mockResolvedValue(undefined);
    const event: CommandInboundEvent = {
      type: 'command.received',
      commandId: 'cmd_1',
    };

    await routeInboundEvent({ ...routerDeps, command: { onCommandEvent } }, event);

    expect(onCommandEvent).toHaveBeenCalledWith(event);
  });

  test('dispatches command-run.updated to handler', async () => {
    const onCommandEvent = vi.fn().mockResolvedValue(undefined);
    const event: CommandInboundEvent = {
      type: 'command-run.updated',
      runId: 'run_1',
    };

    await routeInboundEvent({ ...routerDeps, command: { onCommandEvent } }, event);

    expect(onCommandEvent).toHaveBeenCalledWith(event);
  });

  test('dispatches workspace.list-changed to handler', async () => {
    const onWorkspaceGitEvent = vi.fn().mockResolvedValue(undefined);
    const event: WorkspaceGitInboundEvent = {
      type: 'workspace.list-changed',
      machineId: 'machine_1',
    };

    await routeInboundEvent({ ...routerDeps, workspaceGit: { onWorkspaceGitEvent } }, event);

    expect(onWorkspaceGitEvent).toHaveBeenCalledWith(event);
  });

  test('dispatches git.request to handler', async () => {
    const onWorkspaceGitEvent = vi.fn().mockResolvedValue(undefined);
    const event: WorkspaceGitInboundEvent = {
      type: 'git.request',
      requestId: 'req_1',
    };

    await routeInboundEvent({ ...routerDeps, workspaceGit: { onWorkspaceGitEvent } }, event);

    expect(onWorkspaceGitEvent).toHaveBeenCalledWith(event);
  });

  test('dispatches file-tree.request to handler', async () => {
    const onFileEvent = vi.fn().mockResolvedValue(undefined);
    const event: FileInboundEvent = {
      type: 'file-tree.request',
      requestId: 'req_1',
    };

    await routeInboundEvent({ ...routerDeps, file: { onFileEvent } }, event);

    expect(onFileEvent).toHaveBeenCalledWith(event);
  });

  test('dispatches file-content.request to handler', async () => {
    const onFileEvent = vi.fn().mockResolvedValue(undefined);
    const event: FileInboundEvent = {
      type: 'file-content.request',
      requestId: 'req_2',
    };

    await routeInboundEvent({ ...routerDeps, file: { onFileEvent } }, event);

    expect(onFileEvent).toHaveBeenCalledWith(event);
  });

  test('dispatches file-write.request to handler', async () => {
    const onFileEvent = vi.fn().mockResolvedValue(undefined);
    const event: FileInboundEvent = {
      type: 'file-write.request',
      requestId: 'req_3',
    };

    await routeInboundEvent({ ...routerDeps, file: { onFileEvent } }, event);

    expect(onFileEvent).toHaveBeenCalledWith(event);
  });

  test('dispatches agentic-query.session-opened to handler', async () => {
    const onAgenticQueryEvent = vi.fn().mockResolvedValue(undefined);
    const event: AgenticQueryInboundEvent = {
      type: 'agentic-query.session-opened',
      sessionId: 'run_1',
    };

    await routeInboundEvent({ ...routerDeps, agenticQuery: { onAgenticQueryEvent } }, event);

    expect(onAgenticQueryEvent).toHaveBeenCalledWith(event);
  });

  test('dispatches agentic-query.prompt to handler', async () => {
    const onAgenticQueryEvent = vi.fn().mockResolvedValue(undefined);
    const event: AgenticQueryInboundEvent = {
      type: 'agentic-query.prompt',
      sessionId: 'run_1',
    };

    await routeInboundEvent({ ...routerDeps, agenticQuery: { onAgenticQueryEvent } }, event);

    expect(onAgenticQueryEvent).toHaveBeenCalledWith(event);
  });

  test('dispatches enhancer.job-assigned to handler', async () => {
    const onEnhancerEvent = vi.fn().mockResolvedValue(undefined);
    const event: EnhancerInboundEvent = {
      type: 'enhancer.job-assigned',
      jobId: 'job_1',
    };

    await routeInboundEvent({ ...routerDeps, enhancer: { onEnhancerEvent } }, event);

    expect(onEnhancerEvent).toHaveBeenCalledWith(event);
  });

  test('ignores unhandled event types', async () => {
    const deliverInbound = vi.fn().mockResolvedValue(undefined);
    const onDirectHarnessEvent = vi.fn().mockResolvedValue(undefined);
    const onCommandEvent = vi.fn().mockResolvedValue(undefined);
    const onWorkspaceGitEvent = vi.fn().mockResolvedValue(undefined);
    const onFileEvent = vi.fn().mockResolvedValue(undefined);
    const onAgenticQueryEvent = vi.fn().mockResolvedValue(undefined);
    const onEnhancerEvent = vi.fn().mockResolvedValue(undefined);

    await routeInboundEvent(
      {
        assignedTask: { deliverInbound },
        directHarness: { onDirectHarnessEvent },
        command: { onCommandEvent },
        workspaceGit: { onWorkspaceGitEvent },
        file: { onFileEvent },
        agenticQuery: { onAgenticQueryEvent },
        enhancer: { onEnhancerEvent },
      },
      { type: 'not-a-real-type' } as unknown as InboundEvent
    );

    expect(deliverInbound).not.toHaveBeenCalled();
    expect(onDirectHarnessEvent).not.toHaveBeenCalled();
    expect(onCommandEvent).not.toHaveBeenCalled();
    expect(onWorkspaceGitEvent).not.toHaveBeenCalled();
    expect(onFileEvent).not.toHaveBeenCalled();
    expect(onAgenticQueryEvent).not.toHaveBeenCalled();
    expect(onEnhancerEvent).not.toHaveBeenCalled();
  });
});
