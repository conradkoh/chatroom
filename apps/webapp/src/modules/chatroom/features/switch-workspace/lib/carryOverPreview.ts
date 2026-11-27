/**
 * The carry-over preview for the Review stage.
 *
 * Pure derivation over the chatroom's launch configs and the target machine's harnesses. The UI
 * labels the result "Expected"; the backend repeats this work transactionally, so the preview is
 * never authority.
 */

import { normalizeWorkingDir } from './switchWorkspaceCopy';

export interface CarryOverPreview {
  /**
   * False when the target has not reported its harnesses (the input was null). Then nothing is
   * judged: `expected` and `atRisk` stay empty and the UI must not claim either.
   */
  targetReported: boolean;
  /** Roles whose harness the reported target list includes. Empty when `targetReported` is false. */
  expected: string[];
  /** Roles whose harness the reported target list lacks. Empty when `targetReported` is false. */
  atRisk: { role: string; harness: string }[];
}

export interface PreviewConfig {
  role: string;
  machineId: string;
  workingDir: string;
  agentType: string;
}

/**
 * Configs whose machine and folder match `from` are the ones that would be carried over.
 * `targetHarnesses` is the target's reported harness list, or null when unknown (still loading,
 * or the machine has not reported). A reported list, including [], is authoritative.
 * Returns null when no config belongs to `from`.
 */
// fallow-ignore-next-line complexity
export function buildCarryOverPreview(
  configs: readonly PreviewConfig[],
  from: { machineId: string | null; workingDir: string },
  targetHarnesses: readonly string[] | null
): CarryOverPreview | null {
  const own = configs.filter(
    (c) =>
      c.machineId === from.machineId &&
      normalizeWorkingDir(c.workingDir) === normalizeWorkingDir(from.workingDir)
  );
  if (own.length === 0) return null;
  if (targetHarnesses === null) return { targetReported: false, expected: [], atRisk: [] };
  const expected: string[] = [];
  const atRisk: { role: string; harness: string }[] = [];
  for (const config of own) {
    if (targetHarnesses.includes(config.agentType)) {
      expected.push(config.role);
    } else {
      atRisk.push({ role: config.role, harness: config.agentType });
    }
  }
  return { targetReported: true, expected, atRisk };
}
