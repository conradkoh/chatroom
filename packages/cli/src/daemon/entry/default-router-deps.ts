import type { DatabaseSync } from 'node:sqlite';

import { createAgenticQueryRouterDeps } from './bridge/agentic-query-bridge.js';
import { createAssignedTaskRouterDeps } from './bridge/assigned-task-bridge.js';
import { createCommandRouterDeps } from './bridge/command-bridge.js';
import { createDirectHarnessRouterDeps } from './bridge/direct-harness-bridge.js';
import { createEnhancerRouterDeps } from './bridge/enhancer-bridge.js';
import { createFileRouterDeps } from './bridge/file-bridge.js';
import { createOrchestrationIngressRouterDeps } from './bridge/orchestration-ingress-bridge.js';
import { createWorkspaceGitRouterDeps } from './bridge/workspace-git-bridge.js';
import type { EventRouterDeps } from './event-router.js';
import type { OutboundEvent } from '../domain/entities/outbound-event.js';

export type DefaultEventRouterDepsOptions = {
  db?: DatabaseSync;
  machineId?: string;
  sessionId?: string;
  appendEvent?: (event: OutboundEvent) => void;
  mutate?: (fn: unknown, args: Record<string, unknown>) => Promise<unknown>;
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
    orchestrationIngress: createOrchestrationIngressRouterDeps(opts),
  };
}
