import type { EventRouterDeps } from './event-router.js';

export function createDefaultEventRouterDeps(): EventRouterDeps {
  return {
    assignedTask: {},
    directHarness: {},
    command: {},
    workspaceGit: {},
    file: {},
    agenticQuery: {},
    enhancer: {},
  };
}
