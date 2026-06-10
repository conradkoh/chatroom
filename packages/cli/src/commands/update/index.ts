/**
 * Update command
 * Updates the chatroom CLI to the latest version
 * Phase 7: Migrated to Effect-TS services with typed error handling.
 */

import { exec } from 'node:child_process';
import { promisify } from 'node:util';

import { Effect, type Layer } from 'effect';

import type { UpdateDeps } from './deps.js';
import { UpdateService, UpdateServiceLive } from './update-service.js';
import { getVersion } from '../../version.js';

const execAsync = promisify(exec);

// ─── Re-exports for testing ────────────────────────────────────────────────

export type { UpdateDeps } from './deps.js';

// ─── Domain errors ─────────────────────────────────────────────────────────

export type UpdateError =
  | { readonly _tag: 'NpmNotAvailable' }
  | { readonly _tag: 'VersionCheckFailed' }
  | { readonly _tag: 'UpdateFailed'; readonly cause: Error };

// ─── Default Deps Factory ──────────────────────────────────────────────────

function createDefaultDeps(): UpdateDeps {
  return {
    getVersion,
    exec: (cmd: string) =>
      execAsync(cmd).then((r) => ({ stdout: r.stdout ?? '', stderr: r.stderr })),
  };
}

/**
 * Build Effect Layer from UpdateDeps (for backward-compat with tests)
 */
function layerFromDeps(deps: UpdateDeps): Layer.Layer<UpdateService> {
  return UpdateServiceLive({
    getVersion: deps.getVersion,
    exec: deps.exec,
  });
}

// ─── Effect Programs ───────────────────────────────────────────────────────

/**
 * Pure Effect program — no process.exit, no console.error inside.
 * All errors are typed; caller decides how to handle them.
 */
// fallow-ignore-next-line unused-export
export const updateEffect = (): Effect.Effect<void, UpdateError, UpdateService> =>
  Effect.gen(function* () {
    const updateService = yield* UpdateService;
    const log = console.log.bind(console);

    log('\n🔄 Checking for updates...\n');

    // Check if npm is available
    const npmCheckResult = yield* updateService.exec('npm --version').pipe(
      Effect.catchAll(() =>
        Effect.fail<UpdateError>({
          _tag: 'NpmNotAvailable',
        })
      )
    );

    if (!npmCheckResult) {
      return yield* Effect.fail<UpdateError>({ _tag: 'NpmNotAvailable' });
    }

    const currentVersion = yield* updateService.getVersion();
    log(`   Current version: ${currentVersion}`);

    // Check latest version
    const latestVersionResult = yield* updateService.exec('npm view chatroom-cli version').pipe(
      Effect.catchAll(() =>
        Effect.fail<UpdateError>({
          _tag: 'VersionCheckFailed',
        })
      )
    );

    const latestVersion = latestVersionResult.stdout.trim() || null;

    if (!latestVersion) {
      return yield* Effect.fail<UpdateError>({ _tag: 'VersionCheckFailed' });
    }

    log(`   Latest version:  ${latestVersion}`);

    if (currentVersion === latestVersion) {
      log('\n✅ You already have the latest version!');
      return;
    }

    log('\n📦 Updating to latest version...\n');

    // Install latest version
    const installResult = yield* updateService.exec('npm install -g chatroom-cli@latest').pipe(
      Effect.mapError(
        (cause): UpdateError => ({
          _tag: 'UpdateFailed',
          cause,
        })
      )
    );

    if (installResult.stdout) {
      log(installResult.stdout);
    }

    log('\n✅ Successfully updated chatroom-cli!');
    log(`   ${currentVersion} → ${latestVersion}`);
  });

// ─── Error Handlers ────────────────────────────────────────────────────────

/**
 * Maps typed errors to console.error + process.exit(1) effects.
 * This is the ONLY place process.exit is called in the Effect pipeline.
 */
function handleUpdateError(err: UpdateError): Effect.Effect<void> {
  return Effect.sync(() => {
    if (err._tag === 'NpmNotAvailable') {
      console.error('❌ npm is not available. Please install npm to update.');
      process.exit(1);
    } else if (err._tag === 'VersionCheckFailed') {
      console.error('❌ Could not check for latest version.');
      console.error('   You can manually update with: npm install -g chatroom-cli@latest');
      process.exit(1);
    } else if (err._tag === 'UpdateFailed') {
      console.error(`\n❌ Update failed: ${err.cause.message}`);
      console.error('\n   Try running manually with sudo:');
      console.error('   sudo npm install -g chatroom-cli@latest');
      process.exit(1);
    }
  });
}

// ─── Entry Point (public API — unchanged signature) ────────────────────────

/**
 * Update the CLI to the latest version
 * Runs the Effect and converts typed errors to process.exit + console.error.
 */
export async function update(deps?: UpdateDeps): Promise<void> {
  const d = deps ?? createDefaultDeps();
  const layer = layerFromDeps(d);

  await Effect.runPromise(
    updateEffect().pipe(
      Effect.catchAll((err) => handleUpdateError(err)),
      Effect.provide(layer)
    )
  );
}
