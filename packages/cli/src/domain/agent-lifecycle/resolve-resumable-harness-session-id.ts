/** Harness session IDs tracked by the daemon for one spawn generation. */
export interface HarnessSessionIdPair {
  readonly harnessSessionId: string;
  readonly resumableHarnessSessionId?: string;
}

/** Provider-native session ID used for daemon-memory resume when known. */
export function resolveResumableHarnessSessionId(snapshot: HarnessSessionIdPair): string {
  return snapshot.resumableHarnessSessionId ?? snapshot.harnessSessionId;
}
