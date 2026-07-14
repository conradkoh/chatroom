import { promises as fsPromises, type Dirent } from 'node:fs';
import path from 'node:path';

import { runGit } from '../../git/run-command.js';
import { isAlwaysExcludedDirName, isPathVisible } from './workspace-visibility-policy.js';

export interface GitRepoNode {
  workTree: string;
  gitDir: string;
  relativePath: string;
  pathspec: string[];
  children: GitRepoNode[];
}

export interface GitWorkspaceHierarchy {
  workspaceRoot: string;
  root: GitRepoNode;
}

function normalizeRel(p: string): string {
  return p
    .replace(/\\/g, '/')
    .replace(/^\.\/+/, '')
    .replace(/\/+$/, '');
}

async function revParse(workTree: string, arg: string): Promise<string | null> {
  const result = await runGit(['rev-parse', arg], workTree);
  if ('error' in result) return null;
  const value = result.stdout.trim();
  return value.length > 0 ? value : null;
}

async function resolveGitDir(workTree: string): Promise<string | null> {
  const raw = await revParse(workTree, '--git-dir');
  if (!raw) return null;
  return path.isAbsolute(raw) ? raw : path.resolve(workTree, raw);
}

async function findNestedWorkTrees(workspaceRoot: string): Promise<string[]> {
  const found: string[] = [];

  async function visit(relDir: string): Promise<void> {
    const absDir = relDir ? path.join(workspaceRoot, relDir) : workspaceRoot;
    let dirents: Dirent[];
    try {
      dirents = await fsPromises.readdir(absDir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const ent of dirents) {
      const name = ent.name;
      const relativePath = relDir ? `${relDir}/${name}` : name;

      if (name === '.git') {
        if (relDir) {
          found.push(path.resolve(workspaceRoot, relDir));
        }
        continue;
      }

      if (!ent.isDirectory()) continue;
      if (isAlwaysExcludedDirName(name)) continue;
      if (!isPathVisible(relativePath)) continue;

      await visit(relativePath);
    }
  }

  await visit('');
  return [...new Set(found.map((p) => path.resolve(p)))].sort(
    (a, b) => a.length - b.length || a.localeCompare(b)
  );
}

export async function discoverGitWorkspaceHierarchy(
  workingDir: string
): Promise<GitWorkspaceHierarchy | null> {
  let workspaceRoot: string;
  try {
    workspaceRoot = await fsPromises.realpath(workingDir);
  } catch {
    return null;
  }

  const inside = await runGit(['rev-parse', '--is-inside-work-tree'], workspaceRoot);
  if ('error' in inside || inside.stdout.trim() !== 'true') return null;

  const toplevelRaw = await revParse(workspaceRoot, '--show-toplevel');
  const gitDir = await resolveGitDir(workspaceRoot);
  if (!toplevelRaw || !gitDir) return null;
  const toplevel = path.resolve(toplevelRaw);

  const relFromToplevel = normalizeRel(path.relative(toplevel, workspaceRoot));
  if (relFromToplevel.startsWith('..')) return null;

  const pathspec = relFromToplevel && toplevel !== workspaceRoot ? [relFromToplevel] : [];

  const nestedWorkTrees = await findNestedWorkTrees(workspaceRoot);
  const nestedNodes: GitRepoNode[] = [];
  for (const workTree of nestedWorkTrees) {
    const nestedGitDir = await resolveGitDir(workTree);
    if (!nestedGitDir) continue;
    nestedNodes.push({
      workTree,
      gitDir: nestedGitDir,
      relativePath: normalizeRel(path.relative(workspaceRoot, workTree)),
      pathspec: [],
      children: [],
    });
  }

  const root: GitRepoNode = {
    workTree: toplevel,
    gitDir,
    relativePath: '',
    pathspec,
    children: [],
  };

  const sorted = nestedNodes.sort(
    (a, b) => a.workTree.length - b.workTree.length || a.workTree.localeCompare(b.workTree)
  );

  for (const node of sorted) {
    let parent: GitRepoNode = root;
    for (const candidate of sorted) {
      if (candidate === node) continue;
      const prefix = candidate.workTree.endsWith(path.sep)
        ? candidate.workTree
        : candidate.workTree + path.sep;
      if (node.workTree.startsWith(prefix) && candidate.workTree.length >= parent.workTree.length) {
        parent = candidate;
      }
    }
    parent.children.push(node);
  }

  return { workspaceRoot, root };
}
