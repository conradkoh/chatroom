import type { DatabaseSync } from 'node:sqlite';

import type { OutboundEvent } from '../../domain/entities/outbound-event.js';
import type { HandleOrchestrationIngressInboundDeps } from '../../domain/usecase/handle-orchestration-ingress-inbound.js';

export type OrchestrationIngressRouterOptions = {
  db?: DatabaseSync;
  machineId?: string;
  sessionId?: string;
  appendEvent?: (event: OutboundEvent) => void;
  mutate?: (fn: unknown, args: Record<string, unknown>) => Promise<unknown>;
};

// fallow-ignore-next-line complexity
export function createOrchestrationIngressRouterDeps(
  opts: OrchestrationIngressRouterOptions = {}
): HandleOrchestrationIngressInboundDeps | undefined {
  if (!opts.db || !opts.machineId || !opts.sessionId || !opts.appendEvent || !opts.mutate) {
    return undefined;
  }
  return {
    db: opts.db,
    machineId: opts.machineId,
    sessionId: opts.sessionId,
    appendEvent: opts.appendEvent,
    mutate: opts.mutate,
  };
}
