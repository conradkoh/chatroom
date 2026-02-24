/**
 * Chatroom Init Command
 *
 * Detects AGENTS.md and CLAUDE.md in the target directory and updates the
 * Chatroom Integration section (Section 6) in any it finds. If neither file
 * exists, creates AGENTS.md with the section as its sole content.
 */

import path from 'path';

import type { InitDeps } from './deps.js';

// ─── Re-exports for testing ────────────────────────────────────────────────

export type { InitDeps } from './deps.js';

// ─── Constants ─────────────────────────────────────────────────────────────

/** Files to scan for, in order */
const SUPPORTED_FILES = ['AGENTS.md', 'CLAUDE.md'] as const;

/**
 * The Section 6 text to append.
 * Sourced from packages/cli/README.md lines 154–214 (between the ```markdown fences).
 */
const SECTION_6_TEXT = `<chatroom>
## CHATROOM INTEGRATION

### Workflow Loop

\`\`\`
get-next-task → do work → handoff → get-next-task → repeat
\`\`\`

1. **Run \`get-next-task\`** immediately via \`bash\` — block until task arrives
2. **Process** the task
3. **Run \`handoff\`** to signal completion
4. **Run \`get-next-task\`** again to wait for next task

### Reliability

Always add these as the **last two todo items** for every task:

1. **Handoff item** — contains the full handoff command (see Command Reference)
2. **Get-next-task item** — contains the full get-next-task command (see Command Reference)

This ensures you never forget to pass control back — just copy the command from the todo item and run it via \`bash\`.

### Command Reference

| Action | Command |
|--------|---------|
| Fetch next task | \`CHATROOM_CONVEX_URL=<endpoint> chatroom get-next-task --chatroom-id=<id> --role=<role>\` |
| Pass control | \`CHATROOM_CONVEX_URL=<endpoint> chatroom handoff --chatroom-id=<id> --role=<role> --next-role=<role>\` |
| Refresh system prompt (after compaction) | \`CHATROOM_CONVEX_URL=<endpoint> chatroom get-system-prompt --chatroom-id=<id> --role=<role>\` |

### Context Recovery

If you suspect compaction (context starts with "Summary of:", or you're unsure of your role):

1. Run \`get-system-prompt\` to reload full instructions
2. Check todo list for last known step
3. Resume with \`get-next-task\` or \`handoff\`
</chatroom>`;

// ─── Types ─────────────────────────────────────────────────────────────────

export interface InitOptions {
  dir?: string;
}

export interface InitResult {
  filesModified: string[];
  filesSkipped: string[];
  filesCreated: string[];
}

// ─── Default Deps Factory ──────────────────────────────────────────────────

async function createDefaultDeps(): Promise<InitDeps> {
  const fs = await import('fs/promises');
  return {
    fs: {
      access: async (p) => {
        await fs.access(p);
      },
      readFile: async (p, encoding) => {
        return fs.readFile(p, encoding);
      },
      writeFile: async (p, content, encoding) => {
        await fs.writeFile(p, content, encoding);
      },
    },
  };
}

// ─── Helpers ───────────────────────────────────────────────────────────────

async function fileExists(fsOps: InitDeps['fs'], filePath: string): Promise<boolean> {
  try {
    await fsOps.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function hasIntegrationSection(content: string): boolean {
  return content.includes('<chatroom>');
}

function replaceIntegrationSection(content: string, newSection: string): string {
  const start = content.indexOf('<chatroom>');
  const end = content.indexOf('</chatroom>');
  if (start === -1 || end === -1) {
    // Tags not found — fall back to append
    return content + '\n\n' + newSection;
  }
  const before = content.slice(0, start).replace(/\s+$/, '');
  return before + '\n\n' + newSection;
}

// ─── Entry Point ───────────────────────────────────────────────────────────

/**
 * Initialize chatroom integration in a project directory.
 */
export async function init(options: InitOptions = {}, deps?: InitDeps): Promise<InitResult> {
  const d = deps ?? (await createDefaultDeps());
  const targetDir = options.dir ?? process.cwd();

  const result: InitResult = {
    filesModified: [],
    filesSkipped: [],
    filesCreated: [],
  };

  // Scan for supported files
  const foundFiles: string[] = [];
  for (const filename of SUPPORTED_FILES) {
    const filePath = path.join(targetDir, filename);
    if (await fileExists(d.fs, filePath)) {
      foundFiles.push(filename);
    }
  }

  if (foundFiles.length === 0) {
    // No supported files found — create AGENTS.md
    const agentsPath = path.join(targetDir, 'AGENTS.md');
    try {
      await d.fs.writeFile(agentsPath, SECTION_6_TEXT, 'utf-8');
      result.filesCreated.push('AGENTS.md');
      console.log('✅ Created AGENTS.md with CHATROOM INTEGRATION section');
    } catch (err) {
      console.error(`❌ Failed to create AGENTS.md: ${err}`);
    }
  } else {
    // Process each found file
    for (const filename of foundFiles) {
      const filePath = path.join(targetDir, filename);

      let content: string;
      try {
        content = await d.fs.readFile(filePath, 'utf-8');
      } catch (err) {
        console.error(`❌ Failed to read ${filename}: ${err}`);
        continue;
      }

      if (hasIntegrationSection(content)) {
        try {
          const updatedContent = replaceIntegrationSection(content, SECTION_6_TEXT);
          await d.fs.writeFile(filePath, updatedContent, 'utf-8');
          result.filesModified.push(filename);
          console.log(`✅ Updated CHATROOM INTEGRATION section in ${filename}`);
        } catch (err) {
          console.error(`❌ Failed to update ${filename}: ${err}`);
        }
      } else {
        try {
          const appendText = '\n\n---\n\n' + SECTION_6_TEXT;
          await d.fs.writeFile(filePath, content + appendText, 'utf-8');
          result.filesModified.push(filename);
          console.log(`✅ Added CHATROOM INTEGRATION section to ${filename}`);
        } catch (err) {
          console.error(`❌ Failed to update ${filename}: ${err}`);
        }
      }
    }
  }

  // Print summary
  console.log('');
  console.log('Summary:');
  if (result.filesCreated.length > 0) {
    console.log(`  Created : ${result.filesCreated.join(', ')}`);
  }
  if (result.filesModified.length > 0) {
    console.log(`  Updated : ${result.filesModified.join(', ')}`);
  }
  if (result.filesSkipped.length > 0) {
    console.log(`  Skipped : ${result.filesSkipped.join(', ')} (already has integration section)`);
  }

  const totalActions =
    result.filesCreated.length + result.filesModified.length + result.filesSkipped.length;
  if (totalActions === 0) {
    console.log('  Nothing to do.');
  }

  return result;
}
