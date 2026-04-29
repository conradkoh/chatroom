/**
 * Stable fingerprint for harness list + versions — used to detect when a
 * refreshCapabilities push is needed even if the model snapshot is unchanged.
 */
export function harnessCapabilitiesFingerprint(
  harnesses: readonly string[],
  versions: Record<string, unknown>
): string {
  const h = [...harnesses].sort().join('\u0001');
  const keys = Object.keys(versions).sort();
  const v = keys.map((k) => `${k}:${JSON.stringify(versions[k] ?? null)}`).join('\u0002');
  return `${h}::${v}`;
}
