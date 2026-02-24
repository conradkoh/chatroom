/**
 * Chatroom Init Command
 *
 * Detects AGENTS.md and CLAUDE.md in the target directory and appends the
 * Chatroom Integration section (Section 6) to any it finds. If neither file
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
const SECTION_6_TEXT = `## 6. CHATROOM INTEGRATION

If you are given a role in the chatroom ecosystem, you MUST always direct your questions to the user via the chatroom handoff command with the user as the target chatroom.

The chatroom get-next-task command is of this format:

\`\`\`
CHATROOM_CONVEX_URL=<endpoint> \\
chatroom get-next-task --chatroom-id=<chatroom-id> --role=<role>
\`\`\`

The chatroom handoff command is of this format:

\`\`\`
CHATROOM_CONVEX_URL=<endpoint> \\
chatroom handoff --chatroom-id=<id> --role=<role> --next-role=<role>
\`\`\`

### CRITICAL: Execution Rules for Chatroom Commands

**\`get-next-task\` MUST be executed immediately via the \`bash\` tool — not documented, not deferred.**

The correct session loop is:

1. **Immediately run** \`get-next-task\` via \`bash\` and block until a task arrives
2. **Process** the task
3. **Run** \`handoff\` via \`bash\` to signal completion and pass control
4. **Immediately run** \`get-next-task\` again to wait for the next task

**Common mistakes to avoid:**

- ❌ Adding \`get-next-task\` to the todo list and then returning a summary to the user instead of running it
- ❌ Treating \`get-next-task\` as something to document rather than execute
- ❌ Skipping the \`bash\` tool call and just describing what you would do

The todo list is for _tracking_, not _executing_. The \`bash\` tool is what actually runs the command. Both must be used — add the task to the todo list AND call \`bash\` to execute it.

To ensure that you always get this right, even after compaction, you should always add executing the get-next-task as a todo item, with the full command example and CHATROOM_CONVEX_URL so that you never forget.

### Context Recovery After Compaction

**If you suspect context compaction or summarization has occurred** — for example, if your context window appears to contain only a high-level summary with next steps rather than the full conversation history — re-fetch your system prompt immediately before continuing:

\`\`\`
CHATROOM_CONVEX_URL=<endpoint> \\
chatroom get-system-prompt --chatroom-id=<chatroom-id> --role=<role>
\`\`\`

This prints your complete role instructions to stdout. Read them carefully, then resume the session loop.

**Signs that compaction has occurred:**

- Your context begins with something like "Summary of prior conversation:" or "Context so far:"
- You are unsure of your role, responsibilities, or which commands to run
- You can see "next steps" but no actual conversation history leading up to them

**Recovery procedure:**

1. Run \`get-system-prompt\` to reload your full instructions
2. Check your todo list for the last known next step
3. Resume with \`get-next-task\` or \`handoff\` as appropriate`;

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
  // Match any heading that contains CHATROOM INTEGRATION
  return /#+\s.*CHATROOM INTEGRATION/.test(content);
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
        result.filesSkipped.push(filename);
        console.log(`✓ ${filename} already has a CHATROOM INTEGRATION section — skipping`);
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
