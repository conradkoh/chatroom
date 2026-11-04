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
  // session.ts helpers (current preferred API)
  'requireSession',
  'getSession',
  // machineAccess.ts helpers (current preferred API)
  'requireMachineOwner',
  'requireMachineWriteAccess',
  'getMachineOwner',
  // workspaceAccess.ts helpers
  'requireWorkspaceOwner',
  'requireWorkspaceWriteAccess',
  // chatroomAccess.ts helpers
  'requireChatroomAccess',
  'getChatroomAccess',
  'authorizeUserMessageOrTaskAccess',
  // convex/backlog.ts — requireBacklogItemForChatroom → requireChatroomAccess
  'requireBacklogItemForChatroom',
  // savedCommandsAuth.ts — scope-aware access for saved commands
  'requireSavedCommandAccess',
  // scheduledPrompts.ts — delegates to requireChatroomAccess
  'requireScheduledPromptAccess',
  'validateSession',
  'checkSession',
  'getAuthenticatedWebUser',
  'requireAuthenticatedWebUser',
  // NOTE: `requireWebCaller` is deliberately absent. It only validates the
  // session and the web caller type; it never checks resource ownership. File
  // endpoints therefore prove their boundaries in REQUIRED_CHECKS_BY_FILE.
];

/**
 * Files whose endpoints need resource-specific checks instead of the generic
 * "any access check" scan. Every exported mutation/query must appear in
 * REQUIRED_CHECKS_BY_FILE.
 */
const SCOPED_FILES = ['fileAttachments.ts', 'fileStorageSettings.ts'];

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
  'artifacts.ts': [
    'create',
    'update',
    'get',
    'getMany',
    'listByChatroom',
    'getVersions',
    'validateArtifactIds',
  ],
  // attendance.ts: PRE-EXISTING — chatroom-scoped, no access checks
  'attendance.ts': ['recordAttendance', 'deleteAttendanceRecord', 'getAttendanceData'],
  // checklists.ts: PRE-EXISTING — chatroom-scoped, no access checks
  'checklists.ts': [
    'getChecklistState',
    'getChecklistItems',
    'createChecklist',
    'addChecklistItem',
    'toggleChecklistItem',
    'deleteChecklistItem',
    'concludeChecklist',
    'reopenChecklist',
    'clearCompletedItems',
    'reorderChecklistItems',
  ],
  // discussions.ts: PRE-EXISTING — chatroom-scoped, no access checks
  'discussions.ts': [
    'getDiscussionState',
    'getDiscussionMessages',
    'getDiscussionConclusion',
    'getDiscussionsForPresentation',
    'createDiscussion',
    'addDiscussionMessage',
    'concludeDiscussion',
    'reopenDiscussion',
    'deleteDiscussionMessage',
    'updateConclusions',
  ],
  // guidelines.ts: PRE-EXISTING — chatroom-scoped, no access checks
  'guidelines.ts': ['getGuidelines', 'listGuidelineTypes'],
  // integrations.ts: PRE-EXISTING — chatroom-scoped, no access checks
  'integrations.ts': ['list', 'get'],
  // messages.ts: PRE-EXISTING — chatroom-scoped, agent-facing, no access checks on some endpoints
  'messages.ts': ['send', 'sendMessage', 'handoff'],
  // presentations.ts: PRE-EXISTING — chatroom-scoped, no access checks
  'presentations.ts': [
    'getPresentationState',
    'setCurrentSlide',
    'startPresenting',
    'stopPresenting',
  ],
  // tasks.ts: PRE-EXISTING — getTaskLimits is a public config query
  'tasks.ts': ['getTaskLimits'],
  // workspaceFiles.ts: deprecated v1 mutations — throw immediately, no data written
  'workspaceFiles.ts': ['syncFileTree', 'fulfillFileContent'],
  // skills.ts: getDefaultSkillContent reads only static registry data — no DB access, no sensitive data
  'skills.ts': ['getDefaultSkillContent'],
  // e2e.ts: dev-only seeding mutation gated by E2E_SEEDING_ENABLED env var
  'e2e.ts': ['promoteSessionToSystemAdmin'],
};

/**
 * File-attachment endpoints must prove both the caller type and the resource
 * boundary. `requireWebCaller` alone is not enough: it validates the session and
 * never checks ownership.
 *
 * Each entry is a list of requirements; every requirement is a list of
 * alternatives, and the function region must match at least one alternative in
 * every requirement. The region is the exported function plus any local helpers
 * defined directly beneath it, so guards that live in a helper still count.
 */
const REQUIRED_CHECKS_BY_FILE: Record<string, Record<string, string[][]>> = {
  'fileAttachments.ts': {
    // The chatroom helpers resolve the owner; no web-caller gate (CLI sessions
    // reserve uploads on behalf of their chatroom).
    beginUpload: [['requireChatroomAccess']],
    // Session validation plus the owner check in collectDiscardableRows.
    discardUploads: [['validateSession', 'requireSession'], ['ownerUserId']],
    getFileUrls: [['requireWebCaller'], ['ownerUserId', 'requireChatroomAccess']],
    listFiles: [['requireWebCaller'], ['ownerUserId', 'requireChatroomAccess']],
    deleteFile: [['requireWebCaller'], ['ownerUserId']],
    purgeFiles: [['requireWebCaller'], ['requireChatroomAccess', 'ownerUserId']],
  },
  'fileStorageSettings.ts': {
    // User scope only reads/writes the caller's own row.
    getUserFileStorage: [['requireWebCaller']],
    setUserFileStorageQuota: [['requireWebCaller']],
    getChatroomFileStorage: [['requireWebCaller'], ['requireChatroomAccess']],
    setChatroomFileStorageQuota: [['requireWebCaller'], ['requireChatroomAccess']],
  },
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
 * Extract a function's "region": its export declaration through the line
 * before the next `export const`. Regions include local helpers defined below
 * the handler, so a boundary enforced in `runPurgeFiles` or `loadOwnedRows` is
 * still part of the function's check surface.
 *
 * Only used by the scoped file-attachment table; the generic scan stays
 * handler-only.
 */
function extractFunctionRegion(source: string, name: string): string | null {
  const marker = `export const ${name}`;
  const start = source.indexOf(marker);
  if (start === -1) return null;

  const afterMarker = source[start + marker.length];
  if (afterMarker !== undefined && /\w/.test(afterMarker)) return null;

  const nextExport = source.indexOf('export const ', start + marker.length);
  return source.substring(start, nextExport === -1 ? source.length : nextExport);
}

/**
 * Extract an `httpAction` callback body by balanced braces.
 * Matches: `export const NAME = httpAction(async (ctx, request) => { ... })`.
 */
function extractHttpActionBody(source: string, name: string): string | null {
  const marker = `export const ${name} = httpAction(`;
  const start = source.indexOf(marker);
  if (start === -1) return null;

  const braceStart = source.indexOf('{', start + marker.length);
  if (braceStart === -1) return null;

  let depth = 0;
  for (let i = braceStart; i < source.length; i++) {
    if (source[i] === '{') depth++;
    if (source[i] === '}') depth--;
    if (depth === 0) return source.substring(braceStart, i + 1);
  }
  return null;
}

/**
 * Extract a non-exported `function name(...) { ... }` body by balanced braces.
 * Used to prove an upload helper really reads the request body.
 */
function extractDeclaredFunctionBody(source: string, name: string): string | null {
  const marker = new RegExp(`(?:async\\s+)?function\\s+${name}\\s*\\(`);
  const match = marker.exec(source);
  if (!match) return null;

  const braceStart = source.indexOf('{', match.index + match[0].length);
  if (braceStart === -1) return null;

  let depth = 0;
  for (let i = braceStart; i < source.length; i++) {
    if (source[i] === '{') depth++;
    if (source[i] === '}') depth--;
    if (depth === 0) return source.substring(braceStart, i + 1);
  }
  return null;
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
    .map(({ name }) => name);
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

    for (const file of files.filter((f) => !SCOPED_FILES.includes(f))) {
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

    for (const file of files.filter((f) => !SCOPED_FILES.includes(f))) {
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

describe('Security: File attachment access checks', () => {
  const convexDir = path.resolve(__dirname, '../../convex');

  it('every scoped endpoint matches its required checks', () => {
    const violations: string[] = [];

    for (const [file, functions] of Object.entries(REQUIRED_CHECKS_BY_FILE)) {
      const source = fs.readFileSync(path.join(convexDir, file), 'utf-8');
      const exported = extractExportedFunctions(source);
      const exportedNames = new Set(exported.map((fn) => fn.name));

      // A stale table entry would silently scan nothing.
      for (const [fnName, requirements] of Object.entries(functions)) {
        if (!exportedNames.has(fnName)) {
          violations.push(`${file}:${fnName} — table entry does not match an export`);
          continue;
        }

        const region = extractFunctionRegion(source, fnName);
        if (region === null) {
          violations.push(`${file}:${fnName} — could not extract source region`);
          continue;
        }

        for (const alternatives of requirements) {
          if (!alternatives.some((pattern) => region.includes(pattern))) {
            violations.push(`${file}:${fnName} — missing ${alternatives.join(' or ')}`);
          }
        }
      }

      // Every user-facing export must be covered; a new endpoint must not
      // silently escape the scoped scan.
      for (const fn of exported) {
        if (!(fn.name in functions)) {
          violations.push(`${file}:${fn.line} — ${fn.name} has no scoped check entry`);
        }
      }
    }

    if (violations.length > 0) {
      throw new Error(
        `Found ${violations.length} file-attachment access violation(s):\n` +
          violations.map((v) => `  • ${v}`).join('\n') +
          '\n\nAdd the missing guard or update REQUIRED_CHECKS_BY_FILE.'
      );
    }
  });

  it('the upload HTTP action authorizes the ticket before reading the body', () => {
    const source = fs.readFileSync(path.join(convexDir, 'fileAttachments.ts'), 'utf-8');
    const body = extractHttpActionBody(source, 'uploadFileAttachmentHttp');

    expect(body).not.toBeNull();
    const authorizeIndex = body!.indexOf('authorizeUpload');

    // The body may be read inline (`arrayBuffer(`) or through the local
    // `readUploadBody` helper. Whichever call comes first in the action body
    // must come after authorization.
    const directReadIndex = body!.indexOf('arrayBuffer(');
    const helperReadIndex = body!.indexOf('readUploadBody(');
    const bodyReadIndex = [directReadIndex, helperReadIndex]
      .filter((index) => index >= 0)
      .sort((a, b) => a - b)[0];

    expect(authorizeIndex).toBeGreaterThanOrEqual(0);
    expect(bodyReadIndex).toBeDefined();
    expect(authorizeIndex).toBeLessThan(bodyReadIndex);

    // And the helper that the action delegates to must actually read bytes.
    const helperBody = extractDeclaredFunctionBody(source, 'readUploadBody');
    expect(helperBody).not.toBeNull();
    expect(helperBody!).toContain('request.arrayBuffer()');
  });

  it('rejects a handler that only calls requireWebCaller', () => {
    const fixture = [
      'export const onlyWebCaller = mutation({',
      '  args: {},',
      '  handler: async (ctx, args) => {',
      '    const session = await requireWebCaller(ctx, args.sessionId);',
      '    return session;',
      '  },',
      '});',
    ].join('\n');

    const [fn] = extractExportedFunctions(fixture);
    expect(fn).toBeDefined();
    expect(hasAccessCheck(fn!.handlerSource)).toBe(false);
  });
});
