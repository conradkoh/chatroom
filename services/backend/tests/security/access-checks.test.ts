/**
 * Security Enforcement Test — Access Check Verification
 *
 * Scans all convex/*.ts files and verifies every exported mutation/query
 * has an appropriate access check. Prevents regressions where new endpoints
 * are added without authentication or authorization.
 *
 * Uses static analysis (regex/string matching on source) — not AST parsing.
 */

import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';

// ─── Configuration ──────────────────────────────────────────────────────────

/** Directories/files to skip (relative to convex/). */
const SKIP_DIRS = ['auth/', '_generated/', 'utils/'];
const SKIP_FILES = [
  'schema.ts',
  'convex.config.ts',
  'crons.ts',
  'http.ts',
  'migration.ts',
  'migrations.ts',
];

/** Known access check function names. */
const ACCESS_CHECK_PATTERNS = [
  'checkAccess',
  'requireAccess',
  'requireAuthenticatedUser',
  'getAuthenticatedUser',
  'requireChatroomAccess',
  'validateSession',
  'checkSession',
  'getAuthenticatedWebUser',
  'requireAuthenticatedWebUser',
];

/**
 * Allowlist for functions that intentionally skip access checks.
 * Each entry: filename → [functionName, ...] with reason in comment.
 *
 * NOTE: Items marked "PRE-EXISTING" are known gaps discovered during the
 * security audit. They should be addressed in future work but are tracked
 * here to prevent new regressions.
 */
const ALLOWED_WITHOUT_ACCESS_CHECK: Record<string, string[]> = {
  // appinfo.ts: public endpoint — returns app version info, no sensitive data
  'appinfo.ts': ['get'],
  // cliAuth.ts: auth flow endpoints — these are the authentication mechanism itself
  'cliAuth.ts': [
    'createAuthRequest', // Creates unauthenticated auth request (pre-login)
    'getAuthRequestStatus', // Polls auth request status (pre-login, by request ID)
    'getAuthRequestDetails', // Fetches auth request for approval page (web-authenticated separately)
    'approveAuthRequest', // PRE-EXISTING: uses getAuthenticatedWebUser (not in our pattern list)
    'denyAuthRequest', // PRE-EXISTING: uses getAuthenticatedWebUser
    'validateSession', // This IS the session validation endpoint
    'touchSession', // PRE-EXISTING: validates session internally
    'revokeSession', // PRE-EXISTING: validates session internally
    'listUserSessions', // PRE-EXISTING: validates session internally
  ],
  // crypto.ts: action that generates a recovery code (internal use)
  'crypto.ts': ['generateRecoveryCode'],
  // auth.ts: authentication endpoints — these ARE the auth mechanism
  'auth.ts': [
    'getState', // Checks own session state — no sensitive data leak
    'loginAnon', // Login endpoint — pre-authentication
    'logout', // Logout endpoint — destroys own session
    'updateUserName', // PRE-EXISTING: session-based but no explicit check function
    'createLoginCode', // PRE-EXISTING: login code creation flow
    'getActiveLoginCode', // PRE-EXISTING: login code polling
    'verifyLoginCode', // PRE-EXISTING: login code verification flow
    'checkCodeValidity', // PRE-EXISTING: code validity check
  ],
  // sessions.ts: session management — uses internal session validation
  'sessions.ts': [
    'listMySessions', // PRE-EXISTING: uses internal session lookup
    'revokeSession', // PRE-EXISTING: uses internal session lookup
    'revokeAllOtherSessions', // PRE-EXISTING: uses internal session lookup
    'updateSessionActivity', // PRE-EXISTING: uses internal session lookup
  ],
  // artifacts.ts: PRE-EXISTING — chatroom-scoped, no access checks
  'artifacts.ts': ['create', 'update', 'get', 'getMany', 'listByChatroom', 'getVersions', 'validateArtifactIds'],
  // attendance.ts: PRE-EXISTING — chatroom-scoped, no access checks
  'attendance.ts': ['recordAttendance', 'deleteAttendanceRecord', 'getAttendanceData'],
  // checklists.ts: PRE-EXISTING — chatroom-scoped, no access checks
  'checklists.ts': [
    'getChecklistState', 'getChecklistItems',
    'createChecklist', 'addChecklistItem', 'toggleChecklistItem',
    'deleteChecklistItem', 'concludeChecklist', 'reopenChecklist',
    'clearCompletedItems', 'reorderChecklistItems',
  ],
  // discussions.ts: PRE-EXISTING — chatroom-scoped, no access checks
  'discussions.ts': [
    'getDiscussionState', 'getDiscussionMessages', 'getDiscussionConclusion',
    'getDiscussionsForPresentation',
    'createDiscussion', 'addDiscussionMessage', 'concludeDiscussion',
    'reopenDiscussion', 'deleteDiscussionMessage', 'updateConclusions',
  ],
  // guidelines.ts: PRE-EXISTING — chatroom-scoped, no access checks
  'guidelines.ts': ['getGuidelines', 'listGuidelineTypes'],
  // integrations.ts: PRE-EXISTING — chatroom-scoped, no access checks
  'integrations.ts': ['list', 'get'],
  // messages.ts: PRE-EXISTING — chatroom-scoped, agent-facing, no access checks on some endpoints
  'messages.ts': ['send', 'sendHandoff', 'sendMessage', 'handoff'],
  // presentations.ts: PRE-EXISTING — chatroom-scoped, no access checks
  'presentations.ts': ['getPresentationState', 'setCurrentSlide', 'startPresenting', 'stopPresenting'],
  // tasks.ts: PRE-EXISTING — getTaskLimits is a public config query
  'tasks.ts': ['getTaskLimits'],
  // workspaceFiles.ts: deprecated v1 mutations — throw immediately, no data written
  'workspaceFiles.ts': ['syncFileTree', 'fulfillFileContent'],
  // workspaces.ts: deprecated v1 mutations — throw immediately, no data written
  'workspaces.ts': ['upsertFullDiff', 'upsertCommitDetail'],
};

// ─── Helpers ────────────────────────────────────────────────────────────────

interface ExportedFunction {
  name: string;
  type: 'mutation' | 'query' | 'action';
  handlerSource: string;
  line: number;
}

/**
 * Extract exported mutation/query/action definitions from a source file.
 * Finds patterns like: export const myFunc = mutation({ ... handler: async (ctx, args) => { ... } })
 */
function extractExportedFunctions(source: string): ExportedFunction[] {
  const results: ExportedFunction[] = [];

  // Match: export const NAME = mutation|query|action({
  const exportRegex =
    /^export const (\w+)\s*=\s*(mutation|query|action|internalMutation|internalQuery|internalAction)\s*\(/gm;

  let match;
  while ((match = exportRegex.exec(source)) !== null) {
    const name = match[1];
    const rawType = match[2];

    // Skip internal functions — they're not user-facing
    if (rawType.startsWith('internal')) continue;

    const type = rawType as 'mutation' | 'query' | 'action';
    const startPos = match.index;
    const line = source.substring(0, startPos).split('\n').length;

    // Extract the handler body by finding balanced braces after "handler:"
    const handlerIdx = source.indexOf('handler:', startPos);
    if (handlerIdx === -1) continue;

    // Find the opening brace of the handler function
    const braceStart = source.indexOf('{', handlerIdx);
    if (braceStart === -1) continue;

    // Count braces to find the matching closing brace
    let depth = 0;
    let i = braceStart;
    for (; i < source.length; i++) {
      if (source[i] === '{') depth++;
      if (source[i] === '}') depth--;
      if (depth === 0) break;
    }

    const handlerSource = source.substring(braceStart, i + 1);
    results.push({ name, type, handlerSource, line });
  }

  return results;
}

/**
 * Check if a handler source contains at least one access check.
 */
function hasAccessCheck(handlerSource: string): boolean {
  return ACCESS_CHECK_PATTERNS.some((pattern) => handlerSource.includes(pattern));
}

/**
 * Get all convex source files to scan.
 */
function getConvexFiles(): string[] {
  const convexDir = path.resolve(__dirname, '../../convex');
  const files = fs.readdirSync(convexDir);

  return files
    .filter((f) => f.endsWith('.ts'))
    .filter((f) => !f.endsWith('.spec.ts'))
    .filter((f) => !f.endsWith('.test.ts'))
    .filter((f) => !SKIP_FILES.includes(f))
    .filter((f) => !SKIP_DIRS.some((dir) => f.startsWith(dir)))
    .map((f) => ({ name: f, path: path.join(convexDir, f) }))
    .filter(({ path: p }) => fs.statSync(p).isFile())
    .map(({ name, path: p }) => name);
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('Security: Access Check Enforcement', () => {
  const convexDir = path.resolve(__dirname, '../../convex');
  const files = getConvexFiles();

  it('scans at least 10 convex files', () => {
    expect(files.length).toBeGreaterThanOrEqual(10);
  });

  it('every exported mutation has an access check', () => {
    const unprotected: string[] = [];

    for (const file of files) {
      const source = fs.readFileSync(path.join(convexDir, file), 'utf-8');
      const functions = extractExportedFunctions(source);
      const mutations = functions.filter((f) => f.type === 'mutation');
      const allowlist = ALLOWED_WITHOUT_ACCESS_CHECK[file] ?? [];

      for (const fn of mutations) {
        if (allowlist.includes(fn.name)) continue;
        if (!hasAccessCheck(fn.handlerSource)) {
          unprotected.push(`${file}:${fn.line} — ${fn.name} (mutation)`);
        }
      }
    }

    if (unprotected.length > 0) {
      throw new Error(
        `Found ${unprotected.length} unprotected mutation(s):\n` +
          unprotected.map((u) => `  • ${u}`).join('\n') +
          '\n\nAdd an access check or add to ALLOWED_WITHOUT_ACCESS_CHECK with a reason.'
      );
    }
  });

  it('every exported query has an access check', () => {
    const unprotected: string[] = [];

    for (const file of files) {
      const source = fs.readFileSync(path.join(convexDir, file), 'utf-8');
      const functions = extractExportedFunctions(source);
      const queries = functions.filter((f) => f.type === 'query');
      const allowlist = ALLOWED_WITHOUT_ACCESS_CHECK[file] ?? [];

      for (const fn of queries) {
        if (allowlist.includes(fn.name)) continue;
        if (!hasAccessCheck(fn.handlerSource)) {
          unprotected.push(`${file}:${fn.line} — ${fn.name} (query)`);
        }
      }
    }

    if (unprotected.length > 0) {
      throw new Error(
        `Found ${unprotected.length} unprotected query/queries:\n` +
          unprotected.map((u) => `  • ${u}`).join('\n') +
          '\n\nAdd an access check or add to ALLOWED_WITHOUT_ACCESS_CHECK with a reason.'
      );
    }
  });

  it('allowlist entries are still needed (no stale allowlist entries)', () => {
    const stale: string[] = [];

    for (const [file, functions] of Object.entries(ALLOWED_WITHOUT_ACCESS_CHECK)) {
      const filePath = path.join(convexDir, file);
      if (!fs.existsSync(filePath)) {
        stale.push(`${file} — file no longer exists`);
        continue;
      }

      const source = fs.readFileSync(filePath, 'utf-8');
      const exported = extractExportedFunctions(source);
      const exportedNames = new Set(exported.map((f) => f.name));

      for (const fn of functions) {
        if (!exportedNames.has(fn)) {
          stale.push(`${file}:${fn} — function no longer exported`);
          continue;
        }

        // Check if it actually needs the allowlist (maybe someone added an access check)
        const fnDef = exported.find((f) => f.name === fn);
        if (fnDef && hasAccessCheck(fnDef.handlerSource)) {
          stale.push(`${file}:${fn} — now has an access check (can be removed from allowlist)`);
        }
      }
    }

    if (stale.length > 0) {
      throw new Error(
        `Found ${stale.length} stale allowlist entry/entries:\n` +
          stale.map((s) => `  • ${s}`).join('\n') +
          '\n\nRemove from ALLOWED_WITHOUT_ACCESS_CHECK.'
      );
    }
  });
});
