import type {
  EnhancerQueuePort,
  EnqueueEnhancerQueueInput,
} from '../../ports/enhancer-queue.port.js';

export interface EnqueueEnhancerJobDeps {
  queue: EnhancerQueuePort;
}

/** Enqueue a local enhancer job on planner → enhancer handoff (P4). */
export function enqueueEnhancerJob(
  deps: EnqueueEnhancerJobDeps,
  input: EnqueueEnhancerQueueInput
): void {
  deps.queue.enqueue(input);
}
