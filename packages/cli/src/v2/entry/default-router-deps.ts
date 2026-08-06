import { createAgenticQueryRouterDeps } from './bridge/agentic-query-bridge.js';
import { createAssignedTaskRouterDeps } from './bridge/assigned-task-bridge.js';
import { createCommandRouterDeps } from './bridge/command-bridge.js';
import { createDirectHarnessRouterDeps } from './bridge/direct-harness-bridge.js';
import { createFileRouterDeps } from './bridge/file-bridge.js';
import { createWorkspaceGitRouterDeps } from './bridge/workspace-git-bridge.js';
import type { EventRouterDeps } from './event-router.js';

export function createDefaultEventRouterDeps(): EventRouterDeps {
  return {
    assignedTask: createAssignedTaskRouterDeps(),
    directHarness: createDirectHarnessRouterDeps(),
    command: createCommandRouterDeps(),
    workspaceGit: createWorkspaceGitRouterDeps(),
    file: createFileRouterDeps(),
    agenticQuery: createAgenticQueryRouterDeps(),
    enhancer: {},
  };
}
