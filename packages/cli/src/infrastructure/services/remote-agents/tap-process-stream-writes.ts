/**
 * Tap process stdout/stderr writes so harness token activity includes SDK subprocess
 * output that bypasses stream adapters (e.g. cursor-sdk bash tool stdout).
 */
export function tapProcessStreamWrites(onWrite: () => void): () => void {
  const stdoutOriginal = process.stdout.write.bind(process.stdout);
  const stderrOriginal = process.stderr.write.bind(process.stderr);

  const wrap = (original: typeof stdoutOriginal) =>
    ((...args: Parameters<typeof stdoutOriginal>) => {
      onWrite();
      return original(...args);
    }) as typeof process.stdout.write;

  process.stdout.write = wrap(stdoutOriginal);
  process.stderr.write = wrap(stderrOriginal);

  return () => {
    process.stdout.write = stdoutOriginal;
    process.stderr.write = stderrOriginal;
  };
}
