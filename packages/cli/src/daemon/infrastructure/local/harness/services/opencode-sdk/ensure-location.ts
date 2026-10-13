import type { OpenCodeClient } from '@opencode/client';

/**
 * Force the V2 server to load a location before issuing location-scoped queries.
 *
 * `opencode serve` prints its listening URL before the default location is
 * loaded. `agent.list` / `model.list` scoped to that directory return an empty
 * array until the location is warmed, so we ask the server to load it first.
 *
 * Best-effort: if the location call fails (e.g. a test double without a
 * `location` resource), callers still attempt their scoped query.
 */
export async function ensureLocation(client: OpenCodeClient, directory: string): Promise<void> {
  try {
    await client.location.get({ location: { directory } });
  } catch {
    // Non-fatal.
  }
}
