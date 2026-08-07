/** Max target name length — matches command-discovery MAX_NAME_LENGTH */
const MAX_NAME_LENGTH = 256;

/**
 * Parse Makefile targets from file content.
 * Prefers .PHONY-declared targets; falls back to top-level rule targets.
 */
export function parseMakefileTargets(content: string): string[] {
  const phonyTargets = new Set<string>();
  const ruleTargets = new Set<string>();

  for (const line of content.split('\n')) {
    const trimmed = line.trimEnd();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const phonyMatch = trimmed.match(/^\.PHONY:\s*(.+)/);
    if (phonyMatch) {
      for (const t of phonyMatch[1].split(/\s+/)) {
        if (t && t.length <= MAX_NAME_LENGTH && !t.includes('%')) phonyTargets.add(t);
      }
      continue;
    }

    if (line.startsWith('\t') || line.startsWith(' ')) continue;

    const targetMatch = trimmed.match(/^([a-zA-Z][\w.-]*)\s*:/);
    if (!targetMatch) continue;
    const name = targetMatch[1];
    if (name.startsWith('.') || name.includes('%') || name.length > MAX_NAME_LENGTH) continue;
    ruleTargets.add(name);
  }

  const targets = phonyTargets.size > 0 ? phonyTargets : ruleTargets;
  return [...targets].sort();
}
