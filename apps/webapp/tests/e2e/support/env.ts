import fs from 'node:fs';
import path from 'node:path';

const ENV_PATH = path.resolve(__dirname, '../../../.env.local');

/** Pure parser — exported for unit tests */
export function parseEnvContent(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.startsWith('#') || trimmed === '') continue;
    const withoutExport = trimmed.startsWith('export ') ? trimmed.slice(7) : trimmed;
    const eqIndex = withoutExport.indexOf('=');
    if (eqIndex === -1) continue;
    const key = withoutExport.slice(0, eqIndex).trim();
    let value = withoutExport.slice(eqIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    result[key] = value;
  }
  return result;
}

function readEnvFile(): Record<string, string> {
  try {
    return parseEnvContent(fs.readFileSync(ENV_PATH, 'utf-8'));
  } catch {
    return {};
  }
}

function readEnvValue(key: string): string | undefined {
  return readEnvFile()[key];
}

export function getWebappPort(): string {
  const fromEnv = process.env.PORT?.trim();
  if (fromEnv) return fromEnv;
  const fromFile = readEnvValue('PORT')?.trim();
  if (fromFile) return fromFile;
  return '3000';
}

export function getWebappBaseUrl(): string {
  return `http://localhost:${getWebappPort()}`;
}

export function getConvexUrl(): string {
  const fromEnv = process.env.NEXT_PUBLIC_CONVEX_URL?.trim();
  if (fromEnv) return fromEnv;
  const url = readEnvValue('NEXT_PUBLIC_CONVEX_URL')?.trim();
  if (!url) {
    throw new Error('NEXT_PUBLIC_CONVEX_URL not found in apps/webapp/.env.local');
  }
  return url;
}
