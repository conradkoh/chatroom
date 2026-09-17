import type { MutationCtx } from '../../_generated/server';

/** Compatibility no-op: enhancer job rows are authoritative. */
export async function emitEnhancerEvent(
  _ctx: MutationCtx,
  _event: Record<string, unknown>,
  _timestamp: number
): Promise<void> {}
