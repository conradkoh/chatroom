import type { DatabaseSync } from 'node:sqlite';

import { createAgenticQueryRouterDeps } from './bridge/agentic-query-bridge.js';
import { createAssignedTaskRouterDeps } from './bridge/assigned-task-bridge.js';
import { createCommandRouterDeps } from './bridge/command-bridge.js';
import { createDirectHarnessRouterDeps } from './bridge/direct-harness-bridge.js';
import { createEnhancerRouterDeps } from './bridge/enhancer-bridge.js';
import { createFileRouterDeps } from './bridge/file-bridge.js';
import { createWorkspaceGitRouterDeps } from './bridge/workspace-git-bridge.js';
import type { EventRouterDeps } from './event-router.js';

export type DefaultEventRouterDepsOptions = {
  db?: DatabaseSync;
  machineId?: string;
};

export function createDefaultEventRouterDeps(
  opts: DefaultEventRouterDepsOptions = {}
): EventRouterDeps {
  return {
    assignedTask: createAssignedTaskRouterDeps(),
    directHarness: createDirectHarnessRouterDeps(),
    command: createCommandRouterDeps(),
    workspaceGit: createWorkspaceGitRouterDeps(),
    file: createFileRouterDeps(),
    agenticQuery: createAgenticQueryRouterDeps(),
    enhancer: createEnhancerRouterDeps(),
    userMessageIntent: {
      db: opts.db,
      machineId: opts.machineId ?? '',
    },
  };
}
