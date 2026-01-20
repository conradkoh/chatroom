/**
 * CLI Authentication Storage
 * Manages CLI session storage in ~/.chatroom/auth.jsonc
 *
 * Sessions are stored per Convex URL to support multiple environments.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { homedir, hostname } from 'node:os';
import { join } from 'node:path';

import { getConvexUrl } from '../convex/client.js';

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
 * Multi-environment auth storage structure.
 * Sessions are keyed by Convex URL.
 */
interface MultiEnvAuthData {
  // Version of the auth file format
  version: 2;
  // Sessions keyed by Convex URL
  sessions: {
    [convexUrl: string]: AuthData;
  };
}

/**
 * Legacy auth storage (version 1 or unversioned)
 */
interface LegacyAuthData extends AuthData {
  version?: never; // Legacy doesn't have version
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
 * Parse JSONC content (JSON with comments)
 */
function parseJsonc(content: string): unknown {
  const jsonContent = content
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n');
  return JSON.parse(jsonContent);
}

/**
 * Load the raw auth file data
 */
function loadRawAuthData(): MultiEnvAuthData | LegacyAuthData | null {
  const authPath = getAuthFilePath();

  if (!existsSync(authPath)) {
    return null;
  }

  try {
    const content = readFileSync(authPath, 'utf-8');
    return parseJsonc(content) as MultiEnvAuthData | LegacyAuthData;
  } catch {
    return null;
  }
}

/**
 * Check if data is in new multi-environment format
 */
function isMultiEnvFormat(data: unknown): data is MultiEnvAuthData {
  return (
    typeof data === 'object' &&
    data !== null &&
    'version' in data &&
    (data as MultiEnvAuthData).version === 2
  );
}

/**
 * Load the stored authentication data for the current environment
 */
export function loadAuthData(): AuthData | null {
  const rawData = loadRawAuthData();
  if (!rawData) {
    return null;
  }

  // Handle new multi-environment format
  if (isMultiEnvFormat(rawData)) {
    const convexUrl = getConvexUrl();
    return rawData.sessions[convexUrl] ?? null;
  }

  // Handle legacy format - migrate to new format on next save
  // For now, return the legacy data for the production URL only
  const legacyData = rawData as LegacyAuthData;
  return legacyData.sessionId ? legacyData : null;
}

/**
 * Save authentication data for the current environment
 */
export function saveAuthData(data: AuthData): void {
  ensureConfigDir();

  const authPath = getAuthFilePath();
  const convexUrl = getConvexUrl();

  // Load existing data or create new structure
  let multiEnvData: MultiEnvAuthData;
  const rawData = loadRawAuthData();

  if (isMultiEnvFormat(rawData)) {
    // Use existing multi-env data
    multiEnvData = rawData;
  } else if (rawData && (rawData as LegacyAuthData).sessionId) {
    // Migrate legacy data - associate it with production URL
    const legacyData = rawData as LegacyAuthData;
    const productionUrl = 'https://chatroom-cloud.duskfare.com';
    multiEnvData = {
      version: 2,
      sessions: {
        [productionUrl]: {
          sessionId: legacyData.sessionId,
          createdAt: legacyData.createdAt,
          deviceName: legacyData.deviceName,
          cliVersion: legacyData.cliVersion,
        },
      },
    };
  } else {
    // Create new structure
    multiEnvData = {
      version: 2,
      sessions: {},
    };
  }

  // Update session for current environment
  multiEnvData.sessions[convexUrl] = data;

  // Write to file with pretty formatting
  const content = `// Chatroom CLI Authentication
// This file is auto-generated. Do not edit manually.
// Sessions are stored per Convex environment.
// To re-authenticate, run: chatroom auth login
// To logout, run: chatroom auth logout
${JSON.stringify(multiEnvData, null, 2)}
`;

  writeFileSync(authPath, content, 'utf-8');
}

/**
 * Clear authentication data for the current environment (logout)
 */
export function clearAuthData(): boolean {
  const authPath = getAuthFilePath();
  const convexUrl = getConvexUrl();

  const rawData = loadRawAuthData();
  if (!rawData) {
    return false;
  }

  // Handle multi-env format
  if (isMultiEnvFormat(rawData)) {
    if (!rawData.sessions[convexUrl]) {
      return false;
    }
    delete rawData.sessions[convexUrl];

    // If no sessions left, delete the file
    if (Object.keys(rawData.sessions).length === 0) {
      try {
        unlinkSync(authPath);
        return true;
      } catch {
        return false;
      }
    }

    // Otherwise, save updated data
    const content = `// Chatroom CLI Authentication
// This file is auto-generated. Do not edit manually.
// Sessions are stored per Convex environment.
// To re-authenticate, run: chatroom auth login
// To logout, run: chatroom auth logout
${JSON.stringify(rawData, null, 2)}
`;
    writeFileSync(authPath, content, 'utf-8');
    return true;
  }

  // Handle legacy format - just delete the file
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
 * Get all available sessions (for debugging/error messages)
 */
export function getAllSessions(): { url: string; sessionId: string; createdAt?: string }[] {
  const rawData = loadRawAuthData();
  if (!rawData) {
    return [];
  }

  if (isMultiEnvFormat(rawData)) {
    return Object.entries(rawData.sessions).map(([url, data]) => ({
      url,
      sessionId: data.sessionId,
      createdAt: data.createdAt,
    }));
  }

  // Legacy format
  const legacyData = rawData as LegacyAuthData;
  if (legacyData.sessionId) {
    return [
      {
        url: 'https://chatroom-cloud.duskfare.com',
        sessionId: legacyData.sessionId,
        createdAt: legacyData.createdAt,
      },
    ];
  }

  return [];
}

/**
 * Check if there are sessions for URLs OTHER than the current one
 * Returns the URLs that have sessions
 */
export function getOtherSessionUrls(): string[] {
  const currentUrl = getConvexUrl();
  const allSessions = getAllSessions();
  return allSessions.filter((s) => s.url !== currentUrl).map((s) => s.url);
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
