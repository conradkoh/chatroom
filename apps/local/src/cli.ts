import { openBrowser } from './open-browser.js';
import { createAppServer } from './server/create-server.js';
import { loadRuntimeDefaults } from './server/load-runtime-defaults.js';
import { parseLocalConfig } from './server/parse-config.js';
import { ProcessManager } from './server/process-manager.js';
import { findRepoRoot } from './server/repo-root.js';
import { RepoUpdateService } from './server/repo-update-service.js';

const repoRoot = findRepoRoot();

async function main(): Promise<void> {
  const launchConfig = parseLocalConfig(repoRoot);
  const defaults = loadRuntimeDefaults(repoRoot, launchConfig.managerPort);
  const manager = new ProcessManager(repoRoot, launchConfig.managerPort);
  const repoUpdate = new RepoUpdateService(repoRoot);
  repoUpdate.startPolling();
  const app = await createAppServer(manager, launchConfig, defaults, repoUpdate);

  let shuttingDown = false;

  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    process.stderr.write(`\n${signal} received — stopping all processes...\n`);

    const forceExitTimer = setTimeout(() => process.exit(0), 10_000);
    forceExitTimer.unref();

    try {
      repoUpdate.stopPolling();
      await manager.stopStack();
      await app.close();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      process.stderr.write(`Shutdown error: ${message}\n`);
    } finally {
      clearTimeout(forceExitTimer);
      process.exit(0);
    }
  };

  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));

  await app.listen();

  const managerUrl = `http://localhost:${launchConfig.managerPort}`;
  process.stderr.write(`Local dev manager UI: ${managerUrl}\n`);
  void openBrowser(managerUrl);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
