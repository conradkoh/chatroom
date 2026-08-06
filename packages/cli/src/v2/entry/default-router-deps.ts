import { createAssignedTaskRouterDeps } from './bridge/assigned-task-bridge.js';
import { createDirectHarnessRouterDeps } from './bridge/direct-harness-bridge.js';
import type { EventRouterDeps } from './event-router.js';

export function createDefaultEventRouterDeps(): EventRouterDeps {
  return {
    assignedTask: createAssignedTaskRouterDeps(),
    directHarness: createDirectHarnessRouterDeps(),
    command: {},
    workspaceGit: {},
    file: {},
    agenticQuery: {},
    enhancer: {},
  };
}
