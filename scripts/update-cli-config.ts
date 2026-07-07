import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

function readWebappPort(webappEnvPath: string): string | null {
  if (!existsSync(webappEnvPath)) {
    console.log('⚠️  Webapp .env.local not found, skipping webapp URL update');
    return null;
  }

  const portMatch = readFileSync(webappEnvPath, 'utf8').match(/^PORT=(\d+)$/m);
  if (!portMatch) {
    console.log('⚠️  PORT not found in webapp .env.local, skipping webapp URL update');
    return null;
  }

  return portMatch[1];
}

function writeWebappUrl(cliConfigPath: string, webappUrl: string): void {
  let configContent = readFileSync(cliConfigPath, 'utf8');
  const webappUrlField = `"webappUrl": "${webappUrl}"`;

  configContent = configContent.match(/"webappUrl":\s*"[^"]*"/)
    ? configContent.replace(/"webappUrl":\s*"[^"]*"/, webappUrlField)
    : configContent.replace(/("convexUrl":\s*"[^"]*",?)/, `$1\n  ${webappUrlField},`);

  writeFileSync(cliConfigPath, configContent, 'utf8');
  console.log(`✅ Updated webappUrl in CLI config: ${webappUrl}`);
}

export function updateCliConfig(webappEnvPath: string): void {
  console.log('🔧 Checking CLI configuration for webapp URL...');

  const cliConfigPath = join(homedir(), '.chatroom', 'chatroom.jsonc');
  if (!existsSync(cliConfigPath)) {
    console.log('⚠️  CLI config not found at ~/.chatroom/chatroom.jsonc');
    console.log('   Run "chatroom init" to initialize CLI configuration');
    return;
  }

  const port = readWebappPort(webappEnvPath);
  if (!port) return;

  writeWebappUrl(cliConfigPath, `http://localhost:${port}`);
}
