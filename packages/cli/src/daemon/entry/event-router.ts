import type { InboundEvent } from '../domain/entities/inbound-event.js';
import {
  handleAgenticQueryInbound,
  type AgenticQueryInboundEvent,
  type HandleAgenticQueryInboundDeps,
} from '../domain/usecase/handle-agentic-query-inbound.js';
import {
  handleAssignedTaskInbound,
  type AssignedTaskInboundEvent,
  type HandleAssignedTaskInboundDeps,
} from '../domain/usecase/handle-assigned-task-inbound.js';
import {
  handleCommandInbound,
  type CommandInboundEvent,
  type HandleCommandInboundDeps,
} from '../domain/usecase/handle-command-inbound.js';
import {
  handleDirectHarnessInbound,
  type DirectHarnessInboundEvent,
  type HandleDirectHarnessInboundDeps,
} from '../domain/usecase/handle-direct-harness-inbound.js';
import {
  handleEnhancerInbound,
  type EnhancerInboundEvent,
  type HandleEnhancerInboundDeps,
} from '../domain/usecase/handle-enhancer-inbound.js';
import {
  handleFileInbound,
  type FileInboundEvent,
  type HandleFileInboundDeps,
} from '../domain/usecase/handle-file-inbound.js';
import {
  handleWorkspaceGitInbound,
  type HandleWorkspaceGitInboundDeps,
  type WorkspaceGitInboundEvent,
} from '../domain/usecase/handle-workspace-git-inbound.js';

export type EventRouterDeps = {
  assignedTask: HandleAssignedTaskInboundDeps;
  directHarness: HandleDirectHarnessInboundDeps;
  command: HandleCommandInboundDeps;
  workspaceGit: HandleWorkspaceGitInboundDeps;
  file: HandleFileInboundDeps;
  agenticQuery: HandleAgenticQueryInboundDeps;
  enhancer: HandleEnhancerInboundDeps;
};

// fallow-ignore-next-line complexity
export async function routeInboundEvent(deps: EventRouterDeps, event: InboundEvent): Promise<void> {
  switch (event.type) {
    case 'assigned-task.signal':
    case 'assigned-task.presence':
      await handleAssignedTaskInbound(deps.assignedTask, event as AssignedTaskInboundEvent);
      break;
    case 'direct-harness.session-opened':
    case 'direct-harness.prompt':
    case 'direct-harness.command':
      await handleDirectHarnessInbound(deps.directHarness, event as DirectHarnessInboundEvent);
      break;
    case 'command.received':
    case 'command-run.updated':
      await handleCommandInbound(deps.command, event as CommandInboundEvent);
      break;
    case 'workspace.list-changed':
    case 'git.request':
      await handleWorkspaceGitInbound(deps.workspaceGit, event as WorkspaceGitInboundEvent);
      break;
    case 'file-tree.request':
    case 'file-tree.release':
    case 'file-content.request':
    case 'file-write.request':
      await handleFileInbound(deps.file, event as FileInboundEvent);
      break;
    case 'agentic-query.session-opened':
    case 'agentic-query.prompt':
      await handleAgenticQueryInbound(deps.agenticQuery, event as AgenticQueryInboundEvent);
      break;
    case 'enhancer.job-assigned':
      await handleEnhancerInbound(deps.enhancer, event as EnhancerInboundEvent);
      break;
    default:
      void event;
  }
}
