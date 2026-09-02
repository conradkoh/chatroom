export interface HarnessSessionIdPair {
  readonly harnessSessionId: string;
  readonly resumableHarnessSessionId?: string | undefined;
}

export function resolveResumableHarnessSessionId(snapshot: HarnessSessionIdPair): string {
  return snapshot.resumableHarnessSessionId ?? snapshot.harnessSessionId;
}
