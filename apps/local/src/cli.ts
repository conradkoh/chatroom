import { createAppServer } from './server/create-server.js';
import { parseLocalConfig } from './server/parse-config.js';
import { buildProcessDefinitions } from './server/process-definitions.js';
import { ProcessManager } from './server/process-manager.js';
import { findRepoRoot } from './server/repo-root.js';

const repoRoot = findRepoRoot();

async function main(): Promise<void> {
  const config = parseLocalConfig(repoRoot);
  const definitions = buildProcessDefinitions(config);
  const manager = new ProcessManager(definitions, config);
  const app = await createAppServer(manager, config);

  const shutdown = async (signal: string) => {
    process.stderr.write(`\n${signal} received — stopping all processes...\n`);
    await manager.stopAll();
    await app.close();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  await app.listen();
  process.stderr.write(`Convex: ${config.convexUrl} | Webapp: ${config.webappUrl}\n`);
  await manager.startAll();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
