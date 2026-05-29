/**
 * Harness Status Command
 *
 * Runs harness detection on the current machine and prints a table of all
 * registered harnesses with their installation status. Useful for debugging
 * why a harness is or isn't appearing in the UI without needing to inspect
 * daemon logs.
 */

import { Effect } from 'effect';
import {
  initHarnessRegistry,
  getAllHarnesses,
} from '../../infrastructure/services/remote-agents/index.js';
import { BaseCLIAgentService } from '../../infrastructure/services/remote-agents/base-cli-agent-service.js';
import {
  DetectionResult,
  isInstalled,
  isNotInstalled,
  isDetectionError,
} from '../../infrastructure/services/remote-agents/detection-result.js';

interface HarnessStatusRow {
  id: string;
  displayName: string;
  status: 'installed' | 'not-installed' | 'error';
  reason?: string;
}

/**
 * Run detection on all registered harnesses and print their status.
 */
export async function harnessStatus(): Promise<void> {
  initHarnessRegistry();
  const services = getAllHarnesses();

  if (services.length === 0) {
    console.log('No harnesses registered.');
    return;
  }

  console.log('Detecting harness availability...\n');

  const detectOne = (
    service: ReturnType<typeof getAllHarnesses>[number]
  ): Effect.Effect<{ id: string; displayName: string; result: DetectionResult }, never> => {
    if (service instanceof BaseCLIAgentService) {
      return service
        .detectInstallationEffect()
        .pipe(
          Effect.map((result) => ({ id: service.id, displayName: service.displayName, result }))
        );
    }
    return Effect.promise(() => service.isInstalled().catch(() => false)).pipe(
      Effect.map((installed) => ({
        id: service.id,
        displayName: service.displayName,
        result: installed ? DetectionResult.Installed() : DetectionResult.NotInstalled(),
      }))
    );
  };

  const program = Effect.forEach(services, detectOne, { concurrency: 'unbounded' });
  const results = await Effect.runPromise(program);

  const rows: HarnessStatusRow[] = results.map(({ id, displayName, result }) => {
    if (isInstalled(result)) {
      return { id, displayName, status: 'installed' };
    } else if (isNotInstalled(result)) {
      return { id, displayName, status: 'not-installed' };
    } else if (isDetectionError(result)) {
      return { id, displayName, status: 'error', reason: result.reason };
    }
    return { id, displayName, status: 'not-installed' };
  });

  // Compute column widths for alignment
  const idWidth = Math.max(4, ...rows.map((r) => r.id.length));
  const nameWidth = Math.max(11, ...rows.map((r) => r.displayName.length));

  const header =
    `${'ID'.padEnd(idWidth)}  ${'DISPLAY NAME'.padEnd(nameWidth)}  STATUS`;
  const divider = `${'-'.repeat(idWidth)}  ${'-'.repeat(nameWidth)}  ------`;

  console.log(header);
  console.log(divider);

  for (const row of rows) {
    const statusIcon =
      row.status === 'installed' ? '✅ installed' : row.status === 'error' ? '⚠️  error' : '❌ not installed';
    const line = `${row.id.padEnd(idWidth)}  ${row.displayName.padEnd(nameWidth)}  ${statusIcon}`;
    console.log(line);
    if (row.reason) {
      console.log(`  ${' '.repeat(idWidth + nameWidth + 2)}↳ ${row.reason}`);
    }
  }

  console.log('');

  const installedCount = rows.filter((r) => r.status === 'installed').length;
  const totalCount = rows.length;
  console.log(`${installedCount}/${totalCount} harnesses available on this machine.`);
}
