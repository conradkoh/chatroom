/**
 * Shared grouping helpers for the Process Manager / Processes panel.
 * Part of the run-command vertical slice.
 */

import type { RunnableCommand } from '../types/run';

export interface WorkspaceGroup {
  /** Relative path (e.g., '.', 'apps/webapp') */
  path: string;
  /** All commands for this workspace */
  allCommands: RunnableCommand[];
}

/** Extract the script portion of a command name (e.g., 'pnpm: dev' → 'dev'). */
export function extractScriptName(commandName: string): string {
  // Handle patterns like "pnpm: dev", "turbo: build", "@workspace/webapp: dev"
  const colonIdx = commandName.indexOf(':');
  let scriptPart = colonIdx > 0 ? commandName.slice(colonIdx + 1).trim() : commandName;
  // Handle "turbo: build (chatroom-cli)" → "build"
  const parenIdx = scriptPart.indexOf('(');
  if (parenIdx > 0) scriptPart = scriptPart.slice(0, parenIdx).trim();
  return scriptPart;
}

/** Get a compact display name including the tool prefix (e.g., 'pnpm:dev', 'turbo:build'). */
export function getCompactDisplayName(commandName: string, script: string): string {
  const scriptName = extractScriptName(commandName);
  const colonIdx = commandName.indexOf(':');
  if (colonIdx <= 0) return commandName;
  const tool = commandName.slice(0, colonIdx).trim();

  // If the tool is a known PM or 'turbo', use it directly
  const knownTools = ['pnpm', 'npm', 'yarn', 'bun', 'turbo'];
  if (knownTools.includes(tool)) {
    return `${tool}:${scriptName}`;
  }

  // For package-scoped commands (e.g., '@workspace/webapp: build'),
  // infer the PM from the script prefix
  const pmMatch = script.match(/^(pnpm|npm|npx|yarn|bun)\b/);
  const pm = pmMatch ? (pmMatch[1] === 'npx' ? 'turbo' : pmMatch[1]) : 'run';
  return `${pm}:${scriptName}`;
}

export function groupCommandsByWorkspace(
  commands: RunnableCommand[],
  searchQuery: string
): WorkspaceGroup[] {
  // Filter by search query
  const filtered = searchQuery
    ? commands.filter(
        (c) =>
          c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
          c.script.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : commands;

  // Group by workspace path
  const groups = new Map<string, RunnableCommand[]>();

  for (const cmd of filtered) {
    const ws = cmd.subWorkspace?.path ?? '.';
    const existing = groups.get(ws) ?? [];
    existing.push(cmd);
    groups.set(ws, existing);
  }

  // Build workspace groups
  const result: WorkspaceGroup[] = [];
  for (const [path, cmds] of groups) {
    result.push({ path, allCommands: cmds });
  }

  // Sort: '.' (root) first, then alphabetical
  result.sort((a, b) => {
    if (a.path === '.') return -1;
    if (b.path === '.') return 1;
    return a.path.localeCompare(b.path);
  });

  return result;
}
