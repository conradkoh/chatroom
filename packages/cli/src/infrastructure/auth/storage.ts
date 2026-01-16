/**
 * CLI Authentication Storage
 * Manages CLI session storage in ~/.chatroom/auth.jsonc
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { homedir, hostname } from 'node:os';
import { join } from 'node:path';

const CHATROOM_DIR = join(homedir(), '.chatroom');
const AUTH_FILE = 'auth.jsonc';

interface AuthData {
  // The CLI session ID
  sessionId: string;
  // When the session was created
  createdAt: string;
  // The device name used during auth
  deviceName?: string;
  // The CLI version used during auth
  cliVersion?: string;
}

/**
 * Ensure the chatroom config directory exists
 */
function ensureConfigDir(): void {
  if (!existsSync(CHATROOM_DIR)) {
    mkdirSync(CHATROOM_DIR, { recursive: true });
  }
}

/**
 * Get the path to the auth file
 */
export function getAuthFilePath(): string {
  return join(CHATROOM_DIR, AUTH_FILE);
}

/**
 * Load the stored authentication data
 */
export function loadAuthData(): AuthData | null {
  const authPath = getAuthFilePath();

  if (!existsSync(authPath)) {
    return null;
  }

  try {
    const content = readFileSync(authPath, 'utf-8');
    // Remove comments for JSON parsing (JSONC support)
    const jsonContent = content
      .split('\n')
      .filter((line) => !line.trim().startsWith('//'))
      .join('\n');
    return JSON.parse(jsonContent) as AuthData;
  } catch {
    return null;
  }
}

/**
 * Save authentication data
 */
export function saveAuthData(data: AuthData): void {
  ensureConfigDir();

  const authPath = getAuthFilePath();
  const content = `// Chatroom CLI Authentication
// This file is auto-generated. Do not edit manually.
// To re-authenticate, run: chatroom auth login
// To logout, run: chatroom auth logout
{
  "sessionId": "${data.sessionId}",
  "createdAt": "${data.createdAt}"${data.deviceName ? `,\n  "deviceName": "${data.deviceName}"` : ''}${data.cliVersion ? `,\n  "cliVersion": "${data.cliVersion}"` : ''}
}
`;

  writeFileSync(authPath, content, 'utf-8');
}

/**
 * Clear authentication data (logout)
 */
export function clearAuthData(): boolean {
  const authPath = getAuthFilePath();

  if (!existsSync(authPath)) {
    return false;
  }

  try {
    unlinkSync(authPath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if CLI is authenticated
 */
export function isAuthenticated(): boolean {
  const data = loadAuthData();
  return data !== null && !!data.sessionId;
}

/**
 * Get the current session ID
 */
export function getSessionId(): string | null {
  const data = loadAuthData();
  return data?.sessionId ?? null;
}

/**
 * Get device name for auth requests
 */
export function getDeviceName(): string {
  const os = process.platform;
  const host = hostname();
  return `${host} (${os})`;
}

/**
 * Get CLI version for auth requests
 */
export { getVersion as getCliVersion } from '../../version.js';
