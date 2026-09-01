/** Require an explicit harness model — no SDK default fallbacks. */
export function requireHarnessModel(model: string | undefined, context: string): string {
  const trimmed = model?.trim();
  if (!trimmed) {
    throw new Error(`Harness model is required (${context})`);
  }
  return trimmed;
}
