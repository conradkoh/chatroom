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

// Step 1: Find and clean up stuck exports
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

// Step 2: Check if the required backend version is installed locally
function isVersionInstalled(version: string): boolean {
  const binaryDir = join(HOME, '.convex/binaries', version);
  const exists = existsSync(binaryDir);
  console.log(`  ${version} ${exists ? '✓ installed locally' : '✗ not installed locally'}`);
  return exists;
}

// Step 3: Run the dev server
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

// Main
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
isVersionInstalled(version);

console.log('\nStep 5: Starting dev server...');
await runDevServer(version);
