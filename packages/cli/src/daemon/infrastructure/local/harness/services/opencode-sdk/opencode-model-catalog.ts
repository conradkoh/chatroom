import type { ChildProcess } from 'node:child_process';

// fallow-ignore-file complexity
import { createOpencodeClient } from '@opencode-ai/sdk';
import { encodeModelVariant } from '@workspace/backend/src/domain/entities/harness/model-variant.js';

import type { CLIAgentServiceDeps } from '../base-cli-agent-service.js';
import { waitForListeningUrl } from './parse-listening-url.js';

const OPENCODE_COMMAND = 'opencode';
const SERVE_STARTUP_TIMEOUT_MS = 10_000;
const SERVE_KILL_TIMEOUT_MS = 5_000;
const SERVE_KILL_POLL_INTERVAL_MS = 200;

/** Minimal provider.list model shape shared by the v1 and v2 SDK responses. */
export interface OpencodeCatalogModel {
  id: string;
  name: string;
  variants?: Record<string, { disabled?: boolean } | undefined> | undefined;
}

export interface OpencodeCatalogProvider {
  id: string;
  name: string;
  models?: Record<string, OpencodeCatalogModel> | undefined;
}

/**
 * Expand one model id into the canonical model and variant entries.
 *
 * OpenCode's `default` tag represents the unparameterized model. Other tags
 * are meaningful runtime choices and therefore remain encoded even when the
 * SDK returns an empty configuration object for them.
 */
// fallow-ignore-next-line unused-export
export function expandOpencodeModelVariants(
  modelID: string,
  variants?: OpencodeCatalogModel['variants']
): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  const push = (id: string) => {
    if (!seen.has(id)) {
      seen.add(id);
      result.push(id);
    }
  };

  const variantEntries = Object.entries(variants ?? {}).filter(
    ([, config]) => config?.disabled !== true
  );

  if (variantEntries.length === 0) {
    push(modelID);
    return result;
  }

  const hasDefault = variantEntries.some(([tag]) => tag === 'default');
  const pushedPlain = hasDefault;
  if (hasDefault) push(modelID);

  for (const [tag] of variantEntries) {
    if (tag !== 'default') push(encodeModelVariant(modelID, { variant: tag }));
  }

  if (!pushedPlain) {
    push(modelID);
  }
  return result;
}

/** Expand connected providers into canonical provider/model catalog strings. */
// fallow-ignore-next-line unused-export
export function expandOpencodeProviderCatalog(
  providers: readonly OpencodeCatalogProvider[],
  connectedProviderIds: ReadonlySet<string>
): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const provider of providers) {
    if (!connectedProviderIds.has(provider.id)) continue;

    for (const [modelKey, model] of Object.entries(provider.models ?? {})) {
      const modelID = model.id ?? modelKey;
      for (const expandedModelID of expandOpencodeModelVariants(modelID, model.variants)) {
        const entry = `${provider.id}/${expandedModelID}`;
        if (!seen.has(entry)) {
          seen.add(entry);
          result.push(entry);
        }
      }
    }
  }

  return result;
}

/** Display name for a provider model entry, including its variant tag. */
// fallow-ignore-next-line unused-export
export function opencodeModelDisplayName(
  model: OpencodeCatalogModel,
  expandedModelID: string
): string {
  if (!expandedModelID.includes('[variant=')) return model.name;
  const match = expandedModelID.match(/\[variant=([^,\]]+)\]/);
  const tag = match?.[1];
  return tag ? `${model.name} (${tag})` : model.name;
}

/** Map provider models into published provider options with variant expansion. */
export function mapOpencodeProviderModelOptions(
  models: Record<string, OpencodeCatalogModel>
): { modelID: string; name: string }[] {
  const options: { modelID: string; name: string }[] = [];
  for (const [modelKey, model] of Object.entries(models)) {
    const baseId = model.id ?? modelKey;
    for (const expandedId of expandOpencodeModelVariants(baseId, model.variants)) {
      options.push({
        modelID: expandedId,
        name: opencodeModelDisplayName(model, expandedId),
      });
    }
  }
  return options;
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
 * Fetch connected OpenCode provider models and expand their variant tags.
 * Returns an empty list on any serve, SDK, or provider-list failure.
 */
export async function fetchOpencodeProviderModelCatalog(
  deps: Pick<CLIAgentServiceDeps, 'spawn' | 'kill'>,
  workingDir: string
): Promise<string[]> {
  let childProcess: ChildProcess | undefined;

  try {
    childProcess = deps.spawn(OPENCODE_COMMAND, ['serve', '--print-logs', '--log-level', 'WARN'], {
      cwd: workingDir,
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: false,
      detached: true,
    });

    if (!childProcess.pid) {
      throw new Error('Failed to spawn opencode serve process');
    }

    const baseUrl = await waitForListeningUrl(childProcess, {
      timeoutMs: SERVE_STARTUP_TIMEOUT_MS,
    });
    const client = createOpencodeClient({ baseUrl });
    const response = await client.provider.list();
    const data = response.data as
      { all?: OpencodeCatalogProvider[]; connected?: string[] } | undefined;

    return expandOpencodeProviderCatalog(data?.all ?? [], new Set(data?.connected ?? []));
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
