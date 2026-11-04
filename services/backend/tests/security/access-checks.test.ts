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
  // agentWorkspaces.ts — local wrapper that resolves the workspace's chatroom,
  // then delegates to requireChatroomAccess
  'requireChatroomAccessForWorkspace',
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
    // Web caller, ownership (loadOwnedRows), and chatroom access
    // (assertRowsChatroomAccess) are independent guards — one cannot satisfy
    // another.
    getFileUrls: [['requireWebCaller'], ['ownerUserId'], ['requireChatroomAccess']],
    // Web caller, chatroom access for chatroom scope, and ownership for both
    // scopes: filterOwnedRows guards chatroom pages and paginateFiles uses the
    // owner index for user pages.
    listFiles: [['requireWebCaller'], ['requireChatroomAccess'], ['ownerUserId']],
    deleteFile: [['requireWebCaller'], ['ownerUserId']],
    // The endpoint validates the web caller and chatroom access. Ownership is
    // enforced inside purgeFilesBatch, covered by
    // REQUIRED_CHECKS_BY_USECASE_FILE.
    purgeFiles: [['requireWebCaller'], ['requireChatroomAccess']],
  },
  'fileStorageSettings.ts': {
    // User scope only reads/writes the caller's own row.
    getUserFileStorage: [['requireWebCaller']],
    setUserFileStorageQuota: [['requireWebCaller']],
    getChatroomFileStorage: [['requireWebCaller'], ['requireChatroomAccess']],
    setChatroomFileStorageQuota: [['requireWebCaller'], ['requireChatroomAccess']],
  },
};

/**
 * Usecase-level access boundaries. Endpoints that delegate ownership to a
 * usecase are covered here so deleting the owner constraint is still caught.
 *
 * Keys are paths relative to services/backend.
 */
interface UsecaseCheck {
  requirements: string[][];
  /**
   * Narrow the scanned text to one region. `purgeFilesBatch` needs this: its
   * user-scope branch also names `ownerUserId`, so a whole-function match would
   * pass even when the chatroom-scope query lost its owner filter.
   */
  region?: (source: string) => string | null;
}

const REQUIRED_CHECKS_BY_USECASE_FILE: Record<string, Record<string, UsecaseCheck>> = {
  'src/domain/usecase/file-attachment/purge.ts': {
    // Chatroom scope filters on ownerUserId before `take`; user scope reads the
    // by_owner_status_sizeBytes index. Only the chatroom branch proves the
    // filter, because the user branch owns by index.
    purgeFilesBatch: {
      requirements: [['ownerUserId']],
      region: extractChatroomScopeQuery,
    },
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
 *
 * The parameter list is skipped first, then the first `{` that opens a line is
 * the body — this avoids mistaking object types in parameters or in a return
 * type for the body. Used to prove a helper really performs its guard work.
 */
function extractDeclaredFunctionBody(source: string, name: string): string | null {
  const marker = new RegExp(`(?:async\\s+)?function\\s+${name}\\s*\\(`);
  const match = marker.exec(source);
  if (!match) return null;

  // Walk the parameter list so braces inside parameter types are ignored.
  const paramsStart = match.index + match[0].length - 1;
  let paramsDepth = 0;
  let cursor = paramsStart;
  for (; cursor < source.length; cursor++) {
    if (source[cursor] === '(') paramsDepth++;
    if (source[cursor] === ')') paramsDepth--;
    if (paramsDepth === 0) break;
  }
  if (cursor >= source.length) return null;

  // Skip a return type: the body brace is the first `{` that ends its line.
  let braceStart = source.indexOf('{', cursor + 1);
  while (braceStart !== -1) {
    const lineEnd = source.indexOf('\n', braceStart + 1);
    const restOfLine = source.slice(braceStart + 1, lineEnd === -1 ? source.length : lineEnd);
    if (restOfLine.trim() === '') break;
    braceStart = source.indexOf('{', braceStart + 1);
  }
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
 * Returns the chatroom-scope branch of `purgeFilesBatch`'s ternary: from the
 * `chatroomId !== undefined` test through the first `: await` that starts the
 * user-scope branch. Returns null when the branch cannot be found.
 *
 * Callers pass comment-stripped source rather than string-blanked source,
 * because the owner field only appears as a query-field string
 * (`q.field('ownerUserId')`) in this branch.
 */
function extractChatroomScopeQuery(source: string): string | null {
  const branchStart = source.search(/chatroomId\s*!==\s*undefined/);
  if (branchStart === -1) return null;

  const elseIndex = source.indexOf(': await', branchStart);
  if (elseIndex === -1) return null;

  return source.slice(branchStart, elseIndex);
}

/**
 * Removes `//` line comments and block comments without touching comment
 * markers inside string literals (for example URLs).
 *
 * A guard only counts when it survives stripping: text that appears solely in a
 * comment must not satisfy a requirement.
 */
function stripComments(source: string): string {
  let result = '';
  let quote: '"' | "'" | '`' | null = null;
  let i = 0;

  while (i < source.length) {
    const char = source[i]!;
    const next = source[i + 1];

    if (quote !== null) {
      result += char;
      if (char === '\\' && next !== undefined) {
        // Preserve the escaped character so it cannot close the literal.
        result += next;
        i += 2;
        continue;
      }
      if (char === quote) quote = null;
      i += 1;
      continue;
    }

    if (char === '"' || char === "'" || char === '`') {
      quote = char;
      result += char;
      i += 1;
      continue;
    }

    if (char === '/' && next === '/') {
      // Drop to the end of the line, keeping the newline for line structure.
      const lineEnd = source.indexOf('\n', i + 2);
      i = lineEnd === -1 ? source.length : lineEnd;
      continue;
    }

    if (char === '/' && next === '*') {
      // Replace with a space so adjacent tokens do not merge.
      const blockEnd = source.indexOf('*/', i + 2);
      result += ' ';
      i = blockEnd === -1 ? source.length : blockEnd + 2;
      continue;
    }

    result += char;
    i += 1;
  }

  return result;
}

/**
 * Replaces the contents of string literals with spaces, keeping quotes and
 * newlines so line numbers survive. Template-literal `${…}` expressions stay
 * code, so a guard invoked inside an interpolation still counts.
 *
 * Runs after `stripComments`: comment markers inside strings must not be treated
 * as comments, so comments are handled first and string contents are blanked
 * afterwards.
 */
function stripStringContents(source: string): string {
  const result: string[] = [];
  // One entry per open `${…}`: the number of unmatched `{` inside it.
  const expressionDepths: number[] = [];
  let quote: '"' | "'" | '`' | null = null;
  let i = 0;

  while (i < source.length) {
    const char = source[i]!;

    if (quote !== null) {
      if (char === '\\' && i + 1 < source.length) {
        result.push(' ', source[i + 1] === '\n' ? '\n' : ' ');
        i += 2;
        continue;
      }
      if (quote === '`' && char === '$' && source[i + 1] === '{') {
        result.push('$', '{');
        expressionDepths.push(0);
        quote = null;
        i += 2;
        continue;
      }
      if (char === quote) {
        result.push(char);
        quote = null;
        i += 1;
        continue;
      }
      result.push(char === '\n' ? '\n' : ' ');
      i += 1;
      continue;
    }

    const expressionDepth = expressionDepths.at(-1);
    if (expressionDepth !== undefined) {
      if (char === '{') {
        expressionDepths[expressionDepths.length - 1] = expressionDepth + 1;
        result.push(char);
        i += 1;
        continue;
      }
      if (char === '}') {
        if (expressionDepth === 0) {
          expressionDepths.pop();
          result.push(char);
          quote = '`';
        } else {
          expressionDepths[expressionDepths.length - 1] = expressionDepth - 1;
          result.push(char);
        }
        i += 1;
        continue;
      }
    }

    if (char === '"' || char === "'" || char === '`') {
      result.push(char);
      quote = char;
      i += 1;
      continue;
    }

    result.push(char);
    i += 1;
  }

  return result.join('');
}

/** Comment-free, string-free source used for guard matching. */
function toCodeOnly(source: string): string {
  return stripStringContents(stripComments(source));
}

/**
 * Requirements that name a field rather than a function. Everything else is a
 * guard and must be invoked, so its exact name is followed by `(`.
 */
const IDENTIFIER_REQUIREMENTS = new Set(['ownerUserId']);

/** Matches one requirement alternative against code-only source. */
function matchesRequirement(code: string, pattern: string): boolean {
  const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (IDENTIFIER_REQUIREMENTS.has(pattern)) {
    return new RegExp(`\\b${escaped}\\b`).test(code);
  }
  return new RegExp(`\\b${escaped}\\s*\\(`).test(code);
}

/**
 * Check if a handler source calls at least one access check. Commented-out
 * guards and guard names that only appear inside strings never count, and a
 * call to a longer name (for example `requireChatroomAccessLegacy(`) does not
 * satisfy the guard it merely prefixes.
 */
function hasAccessCheck(handlerSource: string): boolean {
  const code = toCodeOnly(handlerSource);
  return ACCESS_CHECK_PATTERNS.some((pattern) => matchesRequirement(code, pattern));
}

/**
 * Returns one message per unmet requirement. Each requirement is a list of
 * alternatives; a requirement holds when at least one alternative matches the
 * (comment- and string-stripped) code.
 */
function findMissingRequirements(code: string, requirements: string[][]): string[] {
  return requirements
    .filter((alternatives) => !alternatives.some((pattern) => matchesRequirement(code, pattern)))
    .map((alternatives) => `missing ${alternatives.join(' or ')}`);
}

/**
 * Collects unmet requirements for one usecase file's checked functions.
 *
 * Kept separate from the test body so fixtures can exercise the same scan.
 */
function findUsecaseViolations(
  file: string,
  source: string,
  checks: Record<string, UsecaseCheck>
): string[] {
  const violations: string[] = [];
  for (const [fnName, check] of Object.entries(checks)) {
    const body = extractDeclaredFunctionBody(source, fnName);
    if (body === null) {
      violations.push(`${file}:${fnName} — could not extract source region`);
      continue;
    }

    // Comments are stripped; strings stay because the owner field is named in a
    // query-field string.
    const code = stripComments(body);
    const region = check.region ? check.region(code) : code;
    if (region === null) {
      violations.push(`${file}:${fnName} — could not extract scoped region`);
      continue;
    }

    for (const missing of findMissingRequirements(region, check.requirements)) {
      violations.push(`${file}:${fnName} — ${missing}`);
    }
  }
  return violations;
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

        const code = toCodeOnly(region);
        for (const missing of findMissingRequirements(code, requirements)) {
          violations.push(`${file}:${fnName} — ${missing}`);
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

  it('every checked usecase matches its required checks', () => {
    const violations: string[] = [];

    for (const [file, functions] of Object.entries(REQUIRED_CHECKS_BY_USECASE_FILE)) {
      const source = fs.readFileSync(path.resolve(__dirname, '../..', file), 'utf-8');
      violations.push(...findUsecaseViolations(file, source, functions));
    }

    if (violations.length > 0) {
      throw new Error(
        `Found ${violations.length} usecase access violation(s):\n` +
          violations.map((v) => `  • ${v}`).join('\n') +
          '\n\nAdd the missing guard or update REQUIRED_CHECKS_BY_USECASE_FILE.'
      );
    }
  });

  it('rejects a purge batch whose owner filter is missing from the chatroom-scope query', () => {
    const file = 'src/domain/usecase/file-attachment/purge.ts';
    const fixture = [
      'async function purgeFilesBatch(ctx, args) {',
      '  const rows =',
      '    args.chatroomId !== undefined',
      "      ? await ctx.db.query('chatroom_fileAttachments')",
      "          .withIndex('by_chatroom_status_sizeBytes', (q) =>",
      "            q.eq('chatroomId', args.chatroomId).eq('status', 'attached')",
      '          )',
      '          .take(FILE_PURGE_BATCH_SIZE)',
      '      : await ctx.db',
      "          .query('chatroom_fileAttachments')",
      "          .withIndex('by_owner_status_sizeBytes', (q) =>",
      "            q.eq('ownerUserId', args.userId).eq('status', 'attached')",
      '          )',
      '          .take(FILE_PURGE_BATCH_SIZE);',
      '  await deleteFileAttachments(ctx, rows);',
      '  return { deleted: rows.length, hasMore: rows.length === FILE_PURGE_BATCH_SIZE };',
      '}',
    ].join('\n');

    expect(findUsecaseViolations(file, fixture, REQUIRED_CHECKS_BY_USECASE_FILE[file]!)).toEqual([
      `${file}:purgeFilesBatch — missing ownerUserId`,
    ]);
  });

  /**
   * Reports upload-order violations in an HTTP action source.
   *
   * Authorization is only meaningful when the action calls
   * `authorizeUploadRequest(` before reading bytes, and that helper must run the
   * ticket query and the reserved-size comparison.
   */
  function findUploadOrderViolations(source: string): string[] {
    const violations: string[] = [];
    const body = extractHttpActionBody(source, 'uploadFileAttachmentHttp');
    if (body === null) {
      return ['uploadFileAttachmentHttp — could not extract action body'];
    }

    const authorizeIndex = body.indexOf('authorizeUploadRequest(');
    if (authorizeIndex < 0) {
      violations.push('uploadFileAttachmentHttp — missing authorizeUploadRequest( call');
    }

    const authorizeBody = extractDeclaredFunctionBody(source, 'authorizeUploadRequest');
    if (authorizeBody === null) {
      violations.push('authorizeUploadRequest — could not extract helper body');
    } else {
      if (!authorizeBody.includes('ctx.runQuery(internal.fileAttachments.authorizeUpload')) {
        violations.push('authorizeUploadRequest — missing authorizeUpload ticket query');
      }
      if (!authorizeBody.includes('assertContentLengthMatches(')) {
        violations.push('authorizeUploadRequest — missing assertContentLengthMatches comparison');
      }
    }

    const bodyReadIndex = ['arrayBuffer(', 'readUploadBody(']
      .map((needle) => body.indexOf(needle))
      .filter((index) => index >= 0)
      .sort((a, b) => a - b)[0];

    if (bodyReadIndex === undefined) {
      violations.push('uploadFileAttachmentHttp — missing body read');
    } else if (authorizeIndex >= 0 && authorizeIndex > bodyReadIndex) {
      violations.push('uploadFileAttachmentHttp — reads the body before authorizing');
    }

    return violations;
  }

  it('the upload HTTP action authorizes the ticket before reading the body', () => {
    const source = fs.readFileSync(path.join(convexDir, 'fileAttachments.ts'), 'utf-8');

    expect(findUploadOrderViolations(source)).toEqual([]);

    // And the helper that the action delegates to must actually read bytes.
    const helperBody = extractDeclaredFunctionBody(source, 'readUploadBody');
    expect(helperBody).not.toBeNull();
    expect(helperBody!).toContain('request.arrayBuffer()');
  });

  it('rejects an action that reads the body before authorizing', () => {
    const fixture = [
      'export const uploadFileAttachmentHttp = httpAction(async (ctx, request) => {',
      '  const body = await readUploadBody(request, 5);',
      '  const authorized = await authorizeUploadRequest(ctx, preflight);',
      '  return authorized;',
      '});',
      '',
      'async function authorizeUploadRequest(ctx, preflight) {',
      '  const auth = await ctx.runQuery(internal.fileAttachments.authorizeUpload, {});',
      '  assertContentLengthMatches(1, 1);',
      '  return auth;',
      '}',
    ].join('\n');

    expect(findUploadOrderViolations(fixture)).toEqual([
      'uploadFileAttachmentHttp — reads the body before authorizing',
    ]);
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

  it('rejects a handler whose guard appears only in a comment', () => {
    const fixture = [
      'export const commentOnly = mutation({',
      '  args: {},',
      '  handler: async (ctx, args) => {',
      '    // await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);',
      '    /* requireChatroomAccess(ctx, args.sessionId, args.chatroomId); */',
      '    return null;',
      '  },',
      '});',
    ].join('\n');

    const [fn] = extractExportedFunctions(fixture);
    expect(fn).toBeDefined();
    // The guard text is present, so comment stripping is what rejects it.
    expect(fn!.handlerSource).toContain('requireChatroomAccess');
    expect(stripComments(fn!.handlerSource)).not.toContain('requireChatroomAccess');
    expect(hasAccessCheck(fn!.handlerSource)).toBe(false);
  });

  it('rejects a handler whose guard appears only in a string literal', () => {
    const fixture = [
      'export const stringOnly = mutation({',
      '  args: {},',
      '  handler: async (ctx, args) => {',
      "    const guardName = 'requireChatroomAccess';",
      '    return guardName;',
      '  },',
      '});',
    ].join('\n');

    const [fn] = extractExportedFunctions(fixture);
    expect(fn).toBeDefined();
    expect(fn!.handlerSource).toContain('requireChatroomAccess');
    expect(hasAccessCheck(fn!.handlerSource)).toBe(false);
  });

  it('rejects a handler that only calls a guard name prefix', () => {
    const fixture = [
      'export const prefixedGuard = mutation({',
      '  args: {},',
      '  handler: async (ctx, args) => {',
      '    const chatroom = await requireChatroomAccessLegacy(ctx, args.sessionId, args.chatroomId);',
      '    return chatroom;',
      '  },',
      '});',
    ].join('\n');

    const [fn] = extractExportedFunctions(fixture);
    expect(fn).toBeDefined();
    expect(fn!.handlerSource).toContain('requireChatroomAccessLegacy(');
    expect(hasAccessCheck(fn!.handlerSource)).toBe(false);
  });

  it('stripComments preserves URLs inside string literals', () => {
    const source = [
      "const single = 'https://example.com'; // trailing comment",
      'const double = "http://example.com/path";',
      '/* block comment */',
      'const value = 1;',
    ].join('\n');

    const stripped = stripComments(source);
    expect(stripped).toContain("'https://example.com'");
    expect(stripped).toContain('"http://example.com/path"');
    expect(stripped).not.toContain('trailing comment');
    expect(stripped).not.toContain('block comment');
    expect(stripped).toContain('const value = 1;');
  });

  it('blanks string contents but keeps quotes and line structure', () => {
    const source = [
      'const url = "http://example.com";',
      'const guard = `requireChatroomAccess`;',
      'const value = 1;',
    ].join('\n');

    const code = toCodeOnly(source);
    expect(code).not.toContain('example.com');
    expect(code).not.toContain('requireChatroomAccess');
    expect(code).toContain('const url = "');
    expect(code).toContain('const value = 1;');
    expect(code.split('\n')).toHaveLength(3);
  });

  it('keeps template-literal interpolations as code', () => {
    const source = 'const value = `prefix ${requireChatroomAccess(ctx, id)} suffix`;';

    expect(toCodeOnly(source)).toContain('requireChatroomAccess(ctx, id)');
  });
});
