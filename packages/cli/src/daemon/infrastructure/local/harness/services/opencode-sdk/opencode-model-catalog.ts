import type { ChildProcess } from 'node:child_process';

// fallow-ignore-file complexity
import { OpenCode, type ModelInfo } from '@opencode/client';
import { encodeModelVariant } from '@workspace/backend/src/domain/entities/harness/model-variant.js';

import type { CLIAgentServiceDeps } from '../base-cli-agent-service.js';
import { ensureLocation } from './ensure-location.js';
import { serverAuthHeaders, waitForListeningUrl } from './parse-listening-url.js';

const OPENCODE_COMMAND = 'opencode';
const SERVE_STARTUP_TIMEOUT_MS = 10_000;
const SERVE_KILL_TIMEOUT_MS = 5_000;
const SERVE_KILL_POLL_INTERVAL_MS = 200;

/** Variant ids that represent the unparameterized model and add no encoded entry. */
const PLAIN_VARIANT_IDS = new Set(['default', 'none']);

/**
 * Expand one model id into the canonical model and variant entries.
 *
 * OpenCode V2 exposes variants as an array of `{ id }`. Variant ids that mean
 * "no special reasoning configuration" (`default`, `none`) are treated as the
 * plain model so the catalog does not expose redundant entries.
 */
// fallow-ignore-next-line unused-export
export function expandOpencodeModelVariants(
  modelID: string,
  variants?: readonly { id: string }[] | undefined
): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  const push = (id: string) => {
    if (!seen.has(id)) {
      seen.add(id);
      result.push(id);
    }
  };

  push(modelID);

  for (const variant of variants ?? []) {
    if (!variant?.id || PLAIN_VARIANT_IDS.has(variant.id)) continue;
    push(encodeModelVariant(modelID, { variant: variant.id }));
  }

  return result;
}

/** Expand enabled models into canonical `provider/model[variant]` catalog strings. */
// fallow-ignore-next-line unused-export
export function expandOpencodeProviderCatalog(models: readonly ModelInfo[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const model of models) {
    if (model.enabled === false) continue;
    const baseModelID = model.modelID ?? model.id;
    for (const expandedModelID of expandOpencodeModelVariants(baseModelID, model.variants)) {
      const entry = `${model.providerID}/${expandedModelID}`;
      if (!seen.has(entry)) {
        seen.add(entry);
        result.push(entry);
      }
    }
  }

  return result;
}

/** Display name for a provider model entry, including its variant tag. */
// fallow-ignore-next-line unused-export
export function opencodeModelDisplayName(model: { name: string }, expandedModelID: string): string {
  if (!expandedModelID.includes('[variant=')) return model.name;
  const match = expandedModelID.match(/\[variant=([^,\]]+)\]/);
  const tag = match?.[1];
  return tag ? `${model.name} (${tag})` : model.name;
}

/** Map a provider's models into published provider options with variant expansion. */
export function mapOpencodeProviderModelOptions(
  models: readonly ModelInfo[]
): { modelID: string; name: string }[] {
  const options: { modelID: string; name: string }[] = [];
  for (const model of models) {
    if (model.enabled === false) continue;
    const baseId = model.modelID ?? model.id;
    for (const expandedId of expandOpencodeModelVariants(baseId, model.variants)) {
      options.push({
        modelID: expandedId,
        name: opencodeModelDisplayName(model, expandedId),
      });
    }
  }
  return options;
}

/** Group models by provider id, preserving the caller's provider order. */
export function groupModelsByProvider(models: readonly ModelInfo[]): Map<string, ModelInfo[]> {
  const byProvider = new Map<string, ModelInfo[]>();
  for (const model of models) {
    const list = byProvider.get(model.providerID);
    if (list) list.push(model);
    else byProvider.set(model.providerID, [model]);
  }
  return byProvider;
}

/** Stop a temporary serve process, escalating from SIGTERM to SIGKILL. */
async function stopServeProcess(deps: Pick<CLIAgentServiceDeps, 'kill'>, child: ChildProcess) {
  const pid = child.pid;
  if (!pid) return;

  try {
    deps.kill(-pid, 'SIGTERM');
  } catch {
    return;
  }

  const deadline = Date.now() + SERVE_KILL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      deps.kill(pid, 0);
    } catch {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, SERVE_KILL_POLL_INTERVAL_MS));
  }

  try {
    deps.kill(-pid, 'SIGKILL');
  } catch {
    // The process may have exited between the final liveness check and SIGKILL.
  }
}

/**
 * Fetch enabled OpenCode models and expand their variant tags.
 * Returns an empty list on any serve, client, or model-list failure.
 */
export async function fetchOpencodeProviderModelCatalog(
  deps: Pick<CLIAgentServiceDeps, 'spawn' | 'kill'>,
  workingDir: string
): Promise<string[]> {
  let childProcess: ChildProcess | undefined;

  try {
    childProcess = deps.spawn(OPENCODE_COMMAND, ['serve', '--print-logs', '--log-level', 'warn'], {
      cwd: workingDir,
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: false,
      detached: true,
    });

    if (!childProcess.pid) {
      throw new Error('Failed to spawn opencode serve process');
    }

    const { url, password } = await waitForListeningUrl(childProcess, {
      timeoutMs: SERVE_STARTUP_TIMEOUT_MS,
    });
    const headers = serverAuthHeaders(password);
    const client = OpenCode.make({ baseUrl: url, ...(headers ? { headers } : {}) });
    await ensureLocation(client, workingDir);
    const response = await client.model.list({ location: { directory: workingDir } });

    return expandOpencodeProviderCatalog(response.data ?? []);
  } catch (err) {
    console.warn(
      `[opencode] provider model catalog failed:`,
      err instanceof Error ? err.message : err
    );
    return [];
  } finally {
    if (childProcess) {
      await stopServeProcess(deps, childProcess);
    }
  }
}
