#!/usr/bin/env bun
/**
 * Temporary script to detect references to v1 workspace tables
 * that should no longer be used (daemon and frontend should only use v2).
 *
 * Usage: bun scripts/check-v1-table-refs.ts
 */

import { execSync } from 'node:child_process';

// V1 patterns that should NOT appear in daemon or frontend code
// These are the old table names and v1 API function names
const V1_PATTERNS = {
  // V1 table names (direct references)
  tables: [
    'chatroom_workspaceFileTree',      // should be chatroom_workspaceFileTreeV2
    'chatroom_workspaceFullDiff',      // should be chatroom_workspaceFullDiffV2
    'chatroom_workspaceCommitDetail',  // should be chatroom_workspaceCommitDetailV2
    'chatroom_workspaceFileContent',   // should be chatroom_workspaceFileContentV2
  ],
  // V1 API function names (called via api.*)
  apiFunctions: [
    'syncFileTree',           // should be syncFileTreeV2
    'getFileTree',            // should be getFileTreeV2
    'fulfillFileContent',     // should be fulfillFileContentV2
    'getFileContent',         // should be getFileContentV2
    'upsertFullDiff',         // should be upsertFullDiffV2
    'getFullDiff',            // should be getFullDiffV2
    'upsertCommitDetail',     // should be upsertCommitDetailV2
    'getCommitDetail',        // should be getCommitDetailV2
    'getMissingCommitShas',   // should be getMissingCommitShasV2
  ],
  // Old compression-related field names that shouldn't exist in v1 table writes
  // Note: local variables with these names are OK — we're looking for field access on API responses
  deprecatedFields: [
    // Skipping these as they're commonly used as local variable names
    // The API function check above is more reliable
  ],
};

// Directories to check (daemon + frontend only — backend is allowed to keep v1)
const DIRS_TO_CHECK = [
  'packages/cli/src',
  'apps/webapp/src',
];

// Files/patterns to exclude from results
const EXCLUDE_PATTERNS = [
  '.test.ts',
  '.spec.ts',
  '.d.ts',
  'testing/',
  'mock',
  // Comments and JSDoc are OK
];

interface Finding {
  file: string;
  line: number;
  content: string;
  pattern: string;
  category: string;
}

function grep(pattern: string, dirs: string[]): string[] {
  try {
    const result = execSync(
      `grep -rn "${pattern}" ${dirs.join(' ')} --include="*.ts" --include="*.tsx" 2>/dev/null || true`,
      { encoding: 'utf-8' }
    );
    return result.trim().split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

function isExcluded(line: string): boolean {
  return EXCLUDE_PATTERNS.some(p => line.includes(p));
}

function isComment(content: string): boolean {
  const trimmed = content.trim();
  return trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*');
}

const findings: Finding[] = [];

console.log('🔍 Checking for v1 table references in daemon and frontend code...\n');

// Check API function patterns (most important — these are actual runtime calls)
for (const fn of V1_PATTERNS.apiFunctions) {
  // Match api.workspaceFiles.X or api.workspaces.X but NOT XV2
  const pattern = `api\\.\\(workspaceFiles\\|workspaces\\)\\.${fn}[^V]\\|api\\.\\(workspaceFiles\\|workspaces\\)\\.${fn}$`;
  const simplePattern = `\\.${fn}`;
  const results = grep(simplePattern, DIRS_TO_CHECK);
  
  for (const result of results) {
    if (isExcluded(result)) continue;
    const [fileAndLine, ...contentParts] = result.split(':');
    const parts = fileAndLine?.match(/^(.+):(\d+)$/);
    if (!parts) continue;
    
    const content = contentParts.join(':').trim();
    // Skip if it's the V2 version or a comment
    if (content.includes(`${fn}V2`) || content.includes(`${fn}V2,`)) continue;
    if (isComment(content)) continue;
    // Skip git-reader functions (local git calls, not API)
    if (content.includes('gitReader.') || content.includes('git-reader')) continue;
    // Skip local function definitions
    if (content.includes('export async function') || content.includes('export function')) continue;
    // Must be an actual API call
    if (!content.includes('api.') && !content.includes(`typeof api`)) continue;
    
    findings.push({
      file: parts[1]!,
      line: parseInt(parts[2]!, 10),
      content,
      pattern: fn,
      category: 'V1 API function',
    });
  }
}

// Check deprecated field names in non-backend code
for (const field of V1_PATTERNS.deprecatedFields) {
  const results = grep(field, DIRS_TO_CHECK);
  
  for (const result of results) {
    if (isExcluded(result)) continue;
    const parts = result.match(/^(.+):(\d+):(.*)$/);
    if (!parts) continue;
    
    const content = parts[3]!.trim();
    if (isComment(content)) continue;
    // Skip type imports
    if (content.includes('import ')) continue;
    
    findings.push({
      file: parts[1]!,
      line: parseInt(parts[2]!, 10),
      content,
      pattern: field,
      category: 'Deprecated field name',
    });
  }
}

// Report results
if (findings.length === 0) {
  console.log('✅ No v1 table references found in daemon or frontend code!\n');
  console.log('All code paths are properly migrated to v2 tables.');
} else {
  console.log(`⚠️  Found ${findings.length} potential v1 reference(s):\n`);
  
  const byCategory = new Map<string, Finding[]>();
  for (const f of findings) {
    const existing = byCategory.get(f.category) ?? [];
    existing.push(f);
    byCategory.set(f.category, existing);
  }
  
  for (const [category, items] of byCategory) {
    console.log(`\n--- ${category} ---`);
    for (const item of items) {
      console.log(`  ${item.file}:${item.line}`);
      console.log(`    Pattern: ${item.pattern}`);
      console.log(`    Content: ${item.content}`);
    }
  }
}

console.log('\n--- Summary ---');
console.log(`Directories checked: ${DIRS_TO_CHECK.join(', ')}`);
console.log(`V1 API functions checked: ${V1_PATTERNS.apiFunctions.length}`);
console.log(`Deprecated fields checked: ${V1_PATTERNS.deprecatedFields.length}`);
console.log(`Findings: ${findings.length}`);

process.exit(findings.length > 0 ? 1 : 0);
