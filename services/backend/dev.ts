#!/usr/bin/env bun

import { Database } from 'bun:sqlite';
import { spawn } from 'bun';
import { readdirSync, statSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';

const HOME = process.env.HOME || '/Users/conradkoh';

// Scan possible deployment directories for this project
function findDeploymentDir(): string | null {
  const stateDir = join(HOME, '.convex/convex-backend-state');
  try {
    const entries = readdirSync(stateDir, { withFileTypes: true });
    const chatroomDirs = entries
      .filter((e) => e.isDirectory() && e.name.startsWith('local-conradkoh-chatroom'))
      .map((e) => ({
        name: e.name,
        path: join(stateDir, e.name),
        mtime: statSync(join(stateDir, e.name)).mtime.getTime(),
      }))
      .sort((a, b) => b.mtime - a.mtime);

    if (chatroomDirs.length > 0) {
      console.log(`Found deployment: ${chatroomDirs[0].name}`);
      return chatroomDirs[0].path;
    }
  } catch (e) {
    console.error('Error scanning deployment dirs:', e.message);
  }
  return null;
}

// Read the deployment's backend version from config.json
function getDeploymentVersion(deployDir: string): string | null {
  const configPath = join(deployDir, 'config.json');
  try {
    const config = JSON.parse(readFileSync(configPath, 'utf-8'));
    if (config.backendVersion) {
      console.log(`Deployment backend version: ${config.backendVersion}`);
      return config.backendVersion;
    }
  } catch (e) {
    console.error('Error reading deployment config:', e.message);
  }
  return null;
}

// Find and clean up stuck exports
function cleanupStuckExports(deployDir: string) {
  const dbPath = join(deployDir, 'convex_local_backend.sqlite3');

  if (!existsSync(dbPath)) {
    console.log('No database found, skipping export cleanup');
    return;
  }

  try {
    const db = new Database(dbPath);
    const stuckExports = db
      .query(
        `SELECT hex(id) as id_hex, ts, json_extract(json_value, '$.state') as state
         FROM documents
         WHERE json_extract(json_value, '$.state') IN ('requested', 'in_progress')`
      )
      .all();

    if (stuckExports.length > 0) {
      console.log(`Found ${stuckExports.length} stuck export(s):`);
      for (const exp of stuckExports) {
        console.log(`  - ${exp.state} (id: ${exp.id_hex}, ts: ${exp.ts})`);
      }
      db.run(
        `DELETE FROM documents
         WHERE json_extract(json_value, '$.state') IN ('requested', 'in_progress')`
      );
      console.log('Deleted stuck exports');
    } else {
      console.log('No stuck exports found');
    }

    db.close();
  } catch (e) {
    console.error('Error cleaning up exports:', e.message);
  }
}

// Run the dev server in upgrade mode — interactive, no version flag
async function runUpgradeDevServer() {
  console.log('\nStarting Convex dev server in upgrade mode...');
  console.log('---');

  const args = ['bunx', 'convex', 'dev', '--local'];

  const proc = spawn(args, {
    env: {
      ...process.env,
      DOCUMENT_RETENTION_DELAY: '1',
      INDEX_RETENTION_DELAY: '1',
      RETENTION_DELETE_FREQUENCY: '10',
    },
    cwd: import.meta.dir,
    stdout: 'inherit',
    stderr: 'inherit',
    stdin: 'inherit',
  });

  await proc.exited;
}

// Run the dev server in normal mode — auto-detects version
async function runDevServer(version: string) {
  const env = {
    ...process.env,
    CONVEX_NON_INTERACTIVE: 'true',
    DOCUMENT_RETENTION_DELAY: '1',
    INDEX_RETENTION_DELAY: '1',
    RETENTION_DELETE_FREQUENCY: '10',
  };

  console.log(`\nStarting Convex dev server...`);
  console.log('---');

  const args = ['bunx', 'convex', 'dev', '--local', '--local-backend-version', version];

  const proc = spawn(args, {
    env,
    cwd: import.meta.dir,
    stdout: 'inherit',
    stderr: 'inherit',
    stdin: 'inherit',
  });

  await proc.exited;
}

// --- Main ---

const isUpgrade = process.env.UPGRADE === 'true';

if (isUpgrade) {
  console.log('=== Convex Dev Server Script (Upgrade Mode) ===\n');

  if (!process.stdin.isTTY) {
    console.error('UPGRADE mode requires an interactive terminal (TTY).');
    console.error('Run this command directly in a terminal, not through a daemon or CI pipeline.');
    process.exit(1);
  }

  console.log('Step 1: Locating deployment...');
  const deployDir = findDeploymentDir();
  if (!deployDir) {
    console.error("No chatroom deployment found. Run 'convex dev --local' once first.");
    process.exit(1);
  }

  console.log('\nStep 2: Cleaning up stuck exports...');
  cleanupStuckExports(deployDir);

  console.log('\nStep 3: Starting dev server interactively (no version pinning)...');
  await runUpgradeDevServer();
} else {
  console.log('=== Convex Dev Server Script ===\n');

  console.log('Step 1: Locating deployment...');
  const deployDir = findDeploymentDir();
  if (!deployDir) {
    console.error("No chatroom deployment found. Run 'convex dev --local' once first.");
    process.exit(1);
  }

  console.log('\nStep 2: Cleaning up stuck exports...');
  cleanupStuckExports(deployDir);

  console.log('\nStep 3: Detecting deployment backend version...');
  const version = getDeploymentVersion(deployDir);
  if (!version) {
    console.error('Could not determine deployment backend version.');
    process.exit(1);
  }

  console.log(`\nStep 4: Checking local availability...`);
  const binaryDir = join(HOME, '.convex/binaries', version);
  console.log(
    `  ${version} ${existsSync(binaryDir) ? '✓ installed locally' : '✗ not installed locally'}`
  );

  console.log('\nStep 5: Starting dev server...');
  await runDevServer(version);
}
