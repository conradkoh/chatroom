import type { FileTreeHydrationPlan } from '@workspace/backend/src/domain/workspace-file-tree/resolve-hydration-plan';
import { useEffect, useRef } from 'react';

/** Runs guarded force-resync once per plan recoveryKey when hydration plan demands recovery. */
export function useFileTreeHydrationRecovery(
  enabled: boolean,
  plan: FileTreeHydrationPlan,
  refresh: (options?: { force?: boolean }) => void
): void {
  const lastRecoveryKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (!enabled || plan.kind !== 'recover') return;
    if (lastRecoveryKeyRef.current === plan.recoveryKey) return;
    lastRecoveryKeyRef.current = plan.recoveryKey;
    refresh({ force: true });
  }, [enabled, plan, refresh]);
}
