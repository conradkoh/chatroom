#!/usr/bin/env bun

/**
 * Development server with production Convex backend
 *
 * Starts the Next.js dev server connected to the production Convex backend.
 * Uses a random available port to avoid conflicts with the regular dev server.
 *
 * Usage:
 *   bun run scripts/dev-prod.ts
 *   # or via package.json:
 *   pnpm dev:prod
 *
 * Environment:
 *   NEXT_PUBLIC_CONVEX_URL is set to production backend
 */

import { spawn } from 'node:child_process';

// Production Convex URL
const PROD_CONVEX_URL = 'https://chatroom-cloud.duskfare.com';

async function main(): Promise<void> {
  const port = 3530;

  console.log('🚀 Starting development server with production backend\n');
  console.log(`   Convex URL: ${PROD_CONVEX_URL}`);
  console.log(`   Port: ${port}`);
  console.log(`   URL: http://localhost:${port}\n`);

  // Spawn Next.js dev server with production Convex URL
  const child = spawn('next', ['dev', '--port', String(port)], {
    stdio: 'inherit',
    env: {
      ...process.env,
      NEXT_PUBLIC_CONVEX_URL: PROD_CONVEX_URL,
    },
  });

  // Handle process exit
  child.on('error', (error) => {
    console.error('❌ Failed to start dev server:', error.message);
    process.exit(1);
  });

  child.on('exit', (code) => {
    process.exit(code ?? 0);
  });

  // Forward signals to child process
  process.on('SIGINT', () => child.kill('SIGINT'));
  process.on('SIGTERM', () => child.kill('SIGINT')); // Convert SIGTERM to SIGINT
}

main();
