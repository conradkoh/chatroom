import type { SkillModule } from '../../registry';

export const workflowSkill: SkillModule = {
  skillId: 'workflow',
  name: 'Structured Workflows',
  description:
    'DAG-based structured workflows for planning and executing multi-step tasks. ' +
    'Create workflows with dependencies, assign steps to roles, and track progress.',
  getPrompt: (cliEnvPrefix: string) => `You have been activated with the "workflow" skill.

## Structured Workflows

Workflows are DAG-based execution plans where each step has dependencies, an assignee, and a specification. Use workflows when a task requires multiple coordinated phases.

## Command Reference

### Create Workflow
\`\`\`
${cliEnvPrefix}chatroom workflow create --chatroom-id=<id> --role=<role> --workflow-key=<key>
\`\`\`
Reads JSON from stdin:
\`\`\`json
{
  "steps": [
    { "stepKey": "schema", "description": "Create database schema", "dependsOn": [], "order": 1 },
    { "stepKey": "backend", "description": "Build backend API", "dependsOn": ["schema"], "order": 2 },
    { "stepKey": "cli", "description": "Build CLI commands", "dependsOn": ["backend"], "order": 3 }
  ]
}
\`\`\`

**Note:** \`assigneeRole\` is not set at create time. Use the \`specify\` command to assign a role and add goal/requirements to each step.

### Specify Step
\`\`\`
${cliEnvPrefix}chatroom workflow specify --chatroom-id=<id> --role=<role> --workflow-key=<key> --step-key=<stepKey> --assignee-role=<role>
\`\`\`
Reads content from stdin with sections:
\`\`\`
---GOAL---
[High-level goal in markdown]
---REQUIREMENTS---
[Specific, verifiable outcomes]
---WARNINGS---
[Optional: things to avoid]
\`\`\`

### Execute Workflow
\`\`\`
${cliEnvPrefix}chatroom workflow execute --chatroom-id=<id> --role=<role> --workflow-key=<key>
\`\`\`
Transitions workflow from draft to active. Root steps (no dependencies) start immediately.

### View Status
\`\`\`
${cliEnvPrefix}chatroom workflow status --chatroom-id=<id> --role=<role> --workflow-key=<key>
\`\`\`
Shows all steps with status (⏳ pending, 🔵 in_progress, ✅ completed, ❌ cancelled) and available next steps.

### Complete Step
\`\`\`
${cliEnvPrefix}chatroom workflow step-complete --chatroom-id=<id> --role=<role> --workflow-key=<key> --step-key=<stepKey>
\`\`\`

### Cancel Step
\`\`\`
${cliEnvPrefix}chatroom workflow step-cancel --chatroom-id=<id> --role=<role> --workflow-key=<key> --step-key=<stepKey> --reason=<text>
\`\`\`

### Exit Workflow
\`\`\`
${cliEnvPrefix}chatroom workflow exit --chatroom-id=<id> --role=<role> --workflow-key=<key> --reason=<text>
\`\`\`
Cancels the entire workflow.

## Workflow Lifecycle
1. **Create** — Define steps with dependencies (creates a DAG)
2. **Specify** (required) — Add goal/requirements/warnings to each step, assign to roles. Steps cannot be completed without a specification.
3. **Execute** — Activate the workflow; root steps become in_progress
4. **Work** — Agents complete their assigned steps
5. **Advance** — Completing a step automatically promotes dependent steps
6. **Complete** — Workflow completes when all steps are terminal (completed/cancelled)

## Best Practices
- Every step must be specified before it can be completed
- Keep steps focused and independently verifiable
- Use meaningful step keys (e.g., "schema", "backend", "tests")
- Specify clear requirements so step completion can be objectively verified
- Use the status command to monitor progress
- Exit the workflow with a reason if the plan needs to change
`,
};
