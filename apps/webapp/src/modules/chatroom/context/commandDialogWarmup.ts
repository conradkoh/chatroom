/** Non-blocking warmup state for command dialogs. */

export type CommandDialogWarmTarget = 'switcher';

export type CommandDialogWarmState = 'cold' | 'warming' | 'warm';

type ScopeKey = string; // 'global' for switcher

const warmStates = new Map<string, CommandDialogWarmState>();

function cacheKey(target: CommandDialogWarmTarget, scope: ScopeKey): string {
  return `${target}:${scope}`;
}

// fallow-ignore-next-line unused-export
export function getCommandDialogWarmState(
  target: CommandDialogWarmTarget,
  scope: ScopeKey
): CommandDialogWarmState {
  return warmStates.get(cacheKey(target, scope)) ?? 'cold';
}

// fallow-ignore-next-line unused-export
export function setCommandDialogWarmState(
  target: CommandDialogWarmTarget,
  scope: ScopeKey,
  state: CommandDialogWarmState
): void {
  warmStates.set(cacheKey(target, scope), state);
}

// fallow-ignore-next-line unused-export
export function invalidateCommandDialogWarmScope(scope: ScopeKey): void {
  for (const key of [...warmStates.keys()]) {
    if (key.endsWith(`:${scope}`)) warmStates.delete(key);
  }
}

/** Schedule idle warmup. Returns cancel function. */
export function scheduleCommandDialogWarmup(
  target: CommandDialogWarmTarget,
  scope: ScopeKey,
  run: () => void
): () => void {
  const key = cacheKey(target, scope);
  if (warmStates.get(key) === 'warm') return () => {};

  setCommandDialogWarmState(target, scope, 'warming');

  let cancelled = false;
  const execute = () => {
    if (cancelled) return;
    try {
      run();
      setCommandDialogWarmState(target, scope, 'warm');
    } catch {
      setCommandDialogWarmState(target, scope, 'cold');
    }
  };

  const idleId =
    typeof requestIdleCallback !== 'undefined'
      ? requestIdleCallback(execute, { timeout: 2000 })
      : setTimeout(execute, 0);

  return () => {
    cancelled = true;
    if (typeof cancelIdleCallback !== 'undefined' && typeof idleId === 'number') {
      cancelIdleCallback(idleId);
    } else {
      clearTimeout(idleId as ReturnType<typeof setTimeout>);
    }
    if (warmStates.get(key) === 'warming') {
      setCommandDialogWarmState(target, scope, 'cold');
    }
  };
}

/** Reset module state between tests. */
// fallow-ignore-next-line unused-export
export function resetCommandDialogWarmupForTests(): void {
  warmStates.clear();
}
