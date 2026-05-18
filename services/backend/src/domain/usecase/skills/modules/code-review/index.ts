import type { SkillModule } from '../../registry';

export const codeReviewSkill: SkillModule = {
  skillId: 'code-review',
  name: 'Code Review',
  description:
    'Use this skill when reviewing, auditing, or giving feedback on code. Covers eight pillars: simplification, type drift, duplication, design patterns, security, test quality, ownership/observability, and dead code elimination.',

  getPrompt: (cliEnvPrefix: string) => `You have been activated with the "code-review" skill.

⚠️ STOP — You are NOT authorized to perform any code review steps until you have created the workflow and confirmed it is running. Do not rely on prior knowledge of the review pillars. The workflow system will disclose each pillar to you one at a time.

---

## Step 1 — Create the workflow (do this NOW, before anything else)

Run the following command. Substitute \`<your-role>\` with your role (e.g. \`planner\`) and \`<chatroom-id>\` with the chatroom ID from your system prompt:

\`\`\`bash
${cliEnvPrefix}chatroom workflow create-from-template --template=code-review --role=<your-role> --chatroom-id=<chatroom-id>
\`\`\`

Note the workflow key from the output — you will need it for every subsequent command.

## Step 2 — Create your review document

Create a temporary markdown file to record findings across all pillars:

\`\`\`bash
# Use the workflow key from Step 1
touch /tmp/code-review-<workflow-key>.md
\`\`\`

Add a header with the file or PR being reviewed and the workflow key.

## Step 3 — Work through each pillar in order

Repeat until all 8 pillars are complete:

1. **View the current pillar:**
   \`\`\`bash
   ${cliEnvPrefix}chatroom workflow step-view --chatroom-id=<chatroom-id> --role=<your-role> --workflow-key=<workflow-key> --step-key=<current-step-key>
   \`\`\`

2. **Review the code against ONLY the criteria disclosed in that step.** Do not apply knowledge of other pillars.

3. **Record your findings** in \`/tmp/code-review-<workflow-key>.md\` under a heading for that pillar.

4. **Mark the step complete to unlock the next pillar:**
   \`\`\`bash
   ${cliEnvPrefix}chatroom workflow step-complete --chatroom-id=<chatroom-id> --role=<your-role> --workflow-key=<workflow-key> --step-key=<current-step-key>
   \`\`\`

The system will tell you what to run next. Repeat until all 8 pillars are done.

## Step 4 — Deliver the review

Once all steps are complete, present the contents of \`/tmp/code-review-<workflow-key>.md\` as your final review output.`,
};
