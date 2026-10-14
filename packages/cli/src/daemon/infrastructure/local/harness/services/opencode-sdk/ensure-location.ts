import type { OpenCodeClient } from '@opencode/client';

/** Delay between readiness probes. */
const WARMUP_POLL_INTERVAL_MS = 150;
/**
 * How long the agent and provider sets must stay unchanged before the location
 * counts as warm. Observed warm-up on a fresh server: changes land in bursts
 * roughly 300ms apart, so two reads 150ms apart can match mid-load.
 */
const WARMUP_STABLE_WINDOW_MS = 1_000;
/** Upper bound on the time spent waiting for a location to settle. */
const WARMUP_CAP_MS = 3_000;

/**
 * Ask the V2 server to load a location, then wait for its catalogue to settle.
 *
 * `opencode serve` prints its listening URL before the default location is
 * loaded. Location-scoped reads (agents, providers, models) return partial or
 * empty results until the load finishes, and that can be several hundred ms
 * after `location.get` resolves. This function:
 *   1. calls `location.get` to trigger the load, then
 *   2. polls `agent.list` and `provider.list` until their combined ids stay
 *      unchanged for ~1s, or until a ~3s cap elapses.
 *
 * Guarantee: best-effort and never throws. On return the catalogue has been
 * stable for about a second, but a slow load can still finish after the cap.
 * Callers must still treat an empty or partial result as possible. A failing or
 * hung probe ends the wait immediately, so this never blocks startup past the cap.
 */
export async function ensureLocation(client: OpenCodeClient, directory: string): Promise<void> {
  try {
    await client.location.get({ location: { directory } });
  } catch {
    // Non-fatal: the readiness poll below and the caller's own query still run.
  }
  await waitForStableCatalogue(client, directory);
}

/** Poll the location's catalogue until it has been unchanged for WARMUP_STABLE_WINDOW_MS. */
async function waitForStableCatalogue(client: OpenCodeClient, directory: string): Promise<void> {
  const deadline = Date.now() + WARMUP_CAP_MS;
  const stability: StabilityState = { key: null, stableSince: 0 };
  while (Date.now() < deadline) {
    const key = await readCatalogueKey(client, directory, deadline - Date.now()).catch(() => null);
    if (key === null) return; // probe failed or hung: stop waiting, best-effort
    if (isCatalogueStable(stability, key, Date.now())) return;
    await sleep(Math.min(WARMUP_POLL_INTERVAL_MS, deadline - Date.now()));
  }
}

interface StabilityState {
  key: string | null;
  stableSince: number;
}

/** Record a probe result; true once the key has been unchanged for WARMUP_STABLE_WINDOW_MS. */
function isCatalogueStable(state: StabilityState, key: string, now: number): boolean {
  if (key !== state.key) {
    state.key = key;
    state.stableSince = now;
    return false;
  }
  return now - state.stableSince >= WARMUP_STABLE_WINDOW_MS;
}

function sleep(ms: number): Promise<void> {
  return new Promise<void>((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

/**
 * Order-independent fingerprint of the agent and provider ids visible in the location.
 * Rejects if the probe does not settle within `timeoutMs`, so a hung server cannot
 * stall harness startup.
 */
async function readCatalogueKey(
  client: OpenCodeClient,
  directory: string,
  timeoutMs: number
): Promise<string> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('location warm-up probe timed out')), timeoutMs);
  });
  try {
    const [agents, providers] = await Promise.race([
      Promise.all([
        client.agent.list({ location: { directory } }),
        client.provider.list({ location: { directory } }),
      ]),
      timeout,
    ]);
    return JSON.stringify([sortedIds(agents.data), sortedIds(providers.data)]);
  } finally {
    clearTimeout(timer);
  }
}

function sortedIds(items: readonly { id: string }[] | undefined): string[] {
  return (items ?? []).map((item) => item.id).sort();
}
