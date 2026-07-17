import type { BoundHarness } from '../../../../domain/direct-harness/entities/bound-harness.js';
import { makeHarnessKey } from '../../../../infrastructure/harnesses/harness-key.js';
import {
  startBoundHarness,
  type NativeDirectHarnessName,
} from '../../../../infrastructure/harnesses/registry.js';

export async function getOrCreateBoundHarness(params: {
  harnesses: Map<string, BoundHarness>;
  workspaceId: string;
  harnessName: string;
  workingDir: string;
  convexUrl: string;
  logPrefix: string;
}): Promise<BoundHarness> {
  const { harnesses, workspaceId, harnessName, workingDir, convexUrl, logPrefix } = params;
  const key = makeHarnessKey(workspaceId, harnessName);
  let harness = harnesses.get(key);
  if (harness && !harness.isAlive()) {
    console.warn(
      `${logPrefix} Harness ${harnessName} for workspace ${workspaceId} is no longer alive — restarting`
    );
    harness.close().catch(() => {});
    harnesses.delete(key);
    harness = undefined;
  }
  if (!harness) {
    harness = await startBoundHarness({
      harnessName: harnessName as NativeDirectHarnessName,
      workingDir,
      workspaceId,
      resolvedConvexUrl: convexUrl,
    });
    harnesses.set(key, harness);
  }
  return harness;
}
