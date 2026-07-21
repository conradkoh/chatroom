import { createAppServer } from './server/create-server.js';
import { buildProcessDefinitions } from './server/process-definitions.js';
import { ProcessManager } from './server/process-manager.js';
import { findRepoRoot } from './server/repo-root.js';

const repoRoot = findRepoRoot();

async function main(): Promise<void> {
  const definitions = buildProcessDefinitions(repoRoot);
  const manager = new ProcessManager(definitions);
  const app = await createAppServer(manager);

  const shutdown = async (signal: string) => {
    process.stderr.write(`\n${signal} received — stopping all processes...\n`);
    await manager.stopAll();
    await app.close();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  await app.listen();
  await manager.startAll();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
