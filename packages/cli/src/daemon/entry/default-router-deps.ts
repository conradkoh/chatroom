import { createAgenticQueryRouterDeps } from './bridge/agentic-query-bridge.js';
import { createCommandRouterDeps } from './bridge/command-bridge.js';
import { createEnhancerRouterDeps } from './bridge/enhancer-bridge.js';
import { createFileRouterDeps } from './bridge/file-bridge.js';
import { createWorkspaceGitRouterDeps } from './bridge/workspace-git-bridge.js';
import type { EventRouterDeps } from './event-router.js';

export function createDefaultEventRouterDeps(): EventRouterDeps {
  return {
    command: createCommandRouterDeps(),
    workspaceGit: createWorkspaceGitRouterDeps(),
    file: createFileRouterDeps(),
    agenticQuery: createAgenticQueryRouterDeps(),
    enhancer: createEnhancerRouterDeps(),
  };
}
