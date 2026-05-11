/**
 * DetectionResult — tri-state discriminated union for harness detection.
 *
 * Replaces the binary boolean return of `checkInstalled` with three outcomes:
 * - installed: command found on PATH
 * - not-installed: command definitively not found (terminal, no retry)
 * - detection-error: transient failure, retried with exponential backoff up to maxAttempts
 */

// ─── Detection Result ─────────────────────────────────────────────────────────

export type DetectionResult =
  | DetectionResult.Installed
  | DetectionResult.NotInstalled
  | DetectionResult.DetectionError;

export namespace DetectionResult {
  export interface Installed {
    readonly _tag: 'Installed';
  }

  export interface NotInstalled {
    readonly _tag: 'NotInstalled';
  }

  export interface DetectionError {
    readonly _tag: 'DetectionError';
    readonly reason: string;
    readonly attempts: number;
  }
}

// ─── Constructors ─────────────────────────────────────────────────────────────

export const DetectionResult = {
  Installed: (): DetectionResult.Installed => ({ _tag: 'Installed' }),
  NotInstalled: (): DetectionResult.NotInstalled => ({ _tag: 'NotInstalled' }),
  DetectionError: (reason: string, attempts: number): DetectionResult.DetectionError => ({
    _tag: 'DetectionError',
    reason,
    attempts,
  }),
} as const;

// ─── Type Guards ──────────────────────────────────────────────────────────────

export function isInstalled(result: DetectionResult): result is DetectionResult.Installed {
  return result._tag === 'Installed';
}

export function isNotInstalled(result: DetectionResult): result is DetectionResult.NotInstalled {
  return result._tag === 'NotInstalled';
}

export function isDetectionError(
  result: DetectionResult
): result is DetectionResult.DetectionError {
  return result._tag === 'DetectionError';
}

// ─── Retry Policy ─────────────────────────────────────────────────────────────

export const DETECTION_RETRY_POLICY = {
  /** Maximum number of detection attempts (1 initial + N-1 retries). */
  maxAttempts: 3,
  /** Initial delay before the first retry (ms). */
  initialDelayMs: 50,
  /** Maximum delay between retries (ms). */
  maxDelayMs: 500,
  /** Multiplicative backoff factor. */
  backoffFactor: 2,
} as const;
