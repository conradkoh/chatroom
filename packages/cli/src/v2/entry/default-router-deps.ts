import { createAssignedTaskRouterDeps } from './bridge/assigned-task-bridge.js';
import type { EventRouterDeps } from './event-router.js';

export function createDefaultEventRouterDeps(): EventRouterDeps {
  return {
    assignedTask: createAssignedTaskRouterDeps(),
    directHarness: {},
    command: {},
    workspaceGit: {},
    file: {},
    agenticQuery: {},
    enhancer: {},
  };
}
