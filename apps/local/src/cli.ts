import { createAppServer } from './server/create-server.js';
import { loadRuntimeDefaults } from './server/load-runtime-defaults.js';
import { parseLocalConfig } from './server/parse-config.js';
import { ProcessManager } from './server/process-manager.js';
import { findRepoRoot } from './server/repo-root.js';

const repoRoot = findRepoRoot();

async function main(): Promise<void> {
  const launchConfig = parseLocalConfig(repoRoot);
  const defaults = loadRuntimeDefaults(repoRoot, launchConfig.managerPort);
  const manager = new ProcessManager(repoRoot, launchConfig.managerPort);
  const app = await createAppServer(manager, launchConfig, defaults);

  const shutdown = async (signal: string) => {
    process.stderr.write(`\n${signal} received — stopping all processes...\n`);
    await manager.stopStack();
    await app.close();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  await app.listen();
  process.stderr.write('Setup UI: open http://localhost:' + launchConfig.managerPort + '\n');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
