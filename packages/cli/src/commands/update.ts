/**
 * Update command
 * Updates the chatroom CLI to the latest version
 */

import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

/**
 * Get the current installed version
 */
function getCurrentVersion(): string {
  // This is set at build time in package.json
  return process.env.npm_package_version || '1.0.0';
}

/**
 * Check if npm is available
 */
async function isNpmAvailable(): Promise<boolean> {
  try {
    await execAsync('npm --version');
    return true;
  } catch {
    return false;
  }
}

/**
 * Get the latest version from npm registry
 */
async function getLatestVersion(): Promise<string | null> {
  try {
    const { stdout } = await execAsync('npm view chatroom-cli version');
    return stdout.trim();
  } catch {
    return null;
  }
}

// eslint-disable-next-line no-console
const log = console.log.bind(console);

export async function update(): Promise<void> {
  log('\n🔄 Checking for updates...\n');

  // Check if npm is available
  if (!(await isNpmAvailable())) {
    console.error('❌ npm is not available. Please install npm to update.');
    process.exit(1);
  }

  const currentVersion = getCurrentVersion();
  log(`   Current version: ${currentVersion}`);

  // Check latest version
  const latestVersion = await getLatestVersion();
  if (!latestVersion) {
    console.error('❌ Could not check for latest version.');
    console.error('   You can manually update with: npm install -g chatroom-cli@latest');
    process.exit(1);
  }

  log(`   Latest version:  ${latestVersion}`);

  if (currentVersion === latestVersion) {
    log('\n✅ You already have the latest version!');
    return;
  }

  log('\n📦 Updating to latest version...\n');

  try {
    const { stdout } = await execAsync('npm install -g chatroom-cli@latest');

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
  }
}
