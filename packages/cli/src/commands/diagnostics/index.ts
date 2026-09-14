import { stat, writeFile } from 'node:fs/promises';

import { requestLocalDaemon } from './local-daemon.js';
import { resolveLocalWebPort } from '../../daemon/entry/resolve-local-web-port.js';
import { createLogRepository } from '../../daemon/infrastructure/repository/log-repository.js';
import { getConvexUrl } from '../../infrastructure/convex/client.js';
import { openLogDatabase, resolveLogsDbPath } from '../../infrastructure/log-server/index.js';
import {
  getMachineConfigPath,
  getMachineId,
  loadDaemonState,
  loadMachineConfig,
} from '../../infrastructure/machine/index.js';
import { getPidFilePath, isDaemonRunning } from '../machine/pid.js';

const MAX_PAGE_SIZE = 1_000;
const MAX_LOG_ENTRIES = 100_000;

export type DiagnosticOptions = {
  chatroomId: string;
  port?: number | undefined;
  output?: string | undefined;
};

export type LogOptions = DiagnosticOptions & {
  since?: string | undefined;
  from?: string | undefined;
  to?: string | undefined;
  source?: string | undefined;
  role?: string | undefined;
  harness?: string | undefined;
  limit?: string | undefined;
  format?: 'text' | 'json' | undefined;
};

function parseDuration(value: string): number {
  const match = /^(\d+(?:\.\d+)?)(ms|s|m|h|d)$/.exec(value.trim().toLowerCase());
  if (!match) throw new Error(`Invalid duration "${value}". Use values such as 15m, 1h, or 2d.`);
  const amount = Number(match[1]);
  const multiplier = { ms: 1, s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 }[
    match[2] as 'ms' | 's' | 'm' | 'h' | 'd'
  ];
  return amount * multiplier;
}

function parseTimestamp(value: string, flag: string): number {
  const numeric = Number(value);
  const timestamp = Number.isFinite(numeric) && value.trim() !== '' ? numeric : Date.parse(value);
  if (!Number.isFinite(timestamp)) throw new Error(`Invalid ${flag} timestamp: ${value}`);
  return timestamp;
}

async function writeOrPrint(value: unknown, output?: string): Promise<void> {
  const rendered = JSON.stringify(value, null, 2);
  if (output) {
    await writeFile(output, `${rendered}\n`, 'utf8');
    console.log(`Wrote diagnostic dump to ${output}`);
    return;
  }
  console.log(rendered);
}

async function localFallbackDebugState(chatroomId: string, port: number, error: unknown) {
  const config = await loadMachineConfig();
  const machineId = await getMachineId();
  const persisted = machineId ? await loadDaemonState(machineId) : null;
  return {
    capturedAt: new Date().toISOString(),
    warning: `Could not connect to local daemon on port ${port}: ${error instanceof Error ? error.message : String(error)}`,
    process: { pidFile: getPidFilePath(), running: isDaemonRunning().running },
    daemon: {
      convexUrl: getConvexUrl(),
      machineConfigPath: getMachineConfigPath(),
      machineId,
      config,
    },
    chatroomId,
    persistedState: persisted,
  };
}

export async function debugDaemon(options: DiagnosticOptions): Promise<void> {
  const port = options.port ?? resolveLocalWebPort();
  let state: unknown;
  try {
    state = await requestLocalDaemon(port, 'daemon.debug.state', {
      chatroomId: options.chatroomId,
    });
  } catch (error) {
    state = await localFallbackDebugState(options.chatroomId, port, error);
  }
  await writeOrPrint(state, options.output);
}

// fallow-ignore-next-line complexity
async function readAllLogs(options: LogOptions, fromTimestamp: number, toTimestamp: number) {
  const dbPath = resolveLogsDbPath();
  try {
    await stat(dbPath);
  } catch {
    return { dbPath, entries: [] };
  }

  const db = openLogDatabase(dbPath);
  try {
    const repository = createLogRepository(db);
    const entries = [];
    let beforeId: number | undefined;
    while (entries.length < MAX_LOG_ENTRIES) {
      const page = repository.queryHistory(
        beforeId,
        MAX_PAGE_SIZE,
        options.source,
        options.chatroomId,
        options.role,
        options.harness,
        fromTimestamp,
        toTimestamp
      );
      if (page.length === 0) break;
      entries.unshift(...page);
      const oldestId = page[0]?.id;
      if (oldestId === undefined || page.length < MAX_PAGE_SIZE) break;
      beforeId = oldestId;
    }
    entries.sort((a, b) => a.id - b.id);
    const limit = options.limit ? Number(options.limit) : undefined;
    if (limit !== undefined) {
      if (!Number.isInteger(limit) || limit < 1)
        throw new Error('--limit must be a positive integer');
      entries.splice(0, Math.max(0, entries.length - limit));
    }
    return { dbPath, entries };
  } finally {
    db.close();
  }
}

// fallow-ignore-next-line complexity
export async function logs(options: LogOptions): Promise<void> {
  const now = Date.now();
  const fromTimestamp = options.from
    ? parseTimestamp(options.from, '--from')
    : now - parseDuration(options.since ?? '1h');
  const toTimestamp = options.to ? parseTimestamp(options.to, '--to') : now;
  if (fromTimestamp > toTimestamp) throw new Error('--from/--to range is inverted');

  const result = await readAllLogs(options, fromTimestamp, toTimestamp);
  const payload = {
    chatroomId: options.chatroomId,
    from: new Date(fromTimestamp).toISOString(),
    to: new Date(toTimestamp).toISOString(),
    filters: {
      ...(options.source ? { source: options.source } : {}),
      ...(options.role ? { role: options.role } : {}),
      ...(options.harness ? { harness: options.harness } : {}),
    },
    dbPath: result.dbPath,
    count: result.entries.length,
    entries: result.entries,
  };
  if (options.format === 'json') {
    await writeOrPrint(payload, options.output);
    return;
  }
  if (options.output) {
    await writeFile(
      options.output,
      result.entries
        .map(
          (entry) =>
            `${new Date(entry.timestamp).toISOString()} [${entry.level}] ${entry.source} ${entry.message}`
        )
        .join('\n') + (result.entries.length ? '\n' : ''),
      'utf8'
    );
    console.log(`Wrote ${result.entries.length} log entries to ${options.output}`);
    return;
  }
  for (const entry of result.entries) {
    const metadata = entry.metadata ? ` ${JSON.stringify(entry.metadata)}` : '';
    console.log(
      `${new Date(entry.timestamp).toISOString()} [${entry.level.toUpperCase()}] ${entry.source} ${entry.message}${metadata}`
    );
  }
  if (result.entries.length === 0) console.log('(no matching logs)');
}
