/**
 * Update command
 * Updates the chatroom CLI to the latest version
 */

import { exec } from 'node:child_process';
import { promisify } from 'node:util';

import type { UpdateDeps } from './deps.js';
import { getVersion } from '../../version.js';

const execAsync = promisify(exec);

// ─── Re-exports for testing ────────────────────────────────────────────────

export type { UpdateDeps } from './deps.js';

// ─── Default Deps Factory ──────────────────────────────────────────────────

function createDefaultDeps(): UpdateDeps {
  return {
    getVersion,
    exec: (cmd: string) =>
      execAsync(cmd).then((r) => ({ stdout: r.stdout ?? '', stderr: r.stderr })),
  };
}

// ─── Entry Point ───────────────────────────────────────────────────────────

export async function update(deps?: UpdateDeps): Promise<void> {
  const d = deps ?? createDefaultDeps();
  const log = console.log.bind(console);

  log('\n🔄 Checking for updates...\n');

  // Check if npm is available
  try {
    await d.exec('npm --version');
  } catch {
    console.error('❌ npm is not available. Please install npm to update.');
    process.exit(1);
    return;
  }

  const currentVersion = d.getVersion();
  log(`   Current version: ${currentVersion}`);

  // Check latest version
  let latestVersion: string | null = null;
  try {
    const { stdout } = await d.exec('npm view chatroom-cli version');
    latestVersion = stdout.trim() || null;
  } catch {
    latestVersion = null;
  }

  if (!latestVersion) {
    console.error('❌ Could not check for latest version.');
    console.error('   You can manually update with: npm install -g chatroom-cli@latest');
    process.exit(1);
    return;
  }

  log(`   Latest version:  ${latestVersion}`);

  if (currentVersion === latestVersion) {
    log('\n✅ You already have the latest version!');
    return;
  }

  log('\n📦 Updating to latest version...\n');

  try {
    const { stdout } = await d.exec('npm install -g chatroom-cli@latest');

    if (stdout) {
      log(stdout);
    }

    log('\n✅ Successfully updated chatroom-cli!');
    log(`   ${currentVersion} → ${latestVersion}`);
  } catch (error) {
    const err = error as Error;
    console.error(`\n❌ Update failed: ${err.message}`);
    console.error('\n   Try running manually with sudo:');
    console.error('   sudo npm install -g chatroom-cli@latest');
    process.exit(1);
    return;
  }
}
