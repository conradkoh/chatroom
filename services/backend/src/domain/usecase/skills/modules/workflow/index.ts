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
Reads JSON from stdin. The JSON body has a single \`steps\` array. Each step has exactly 4 fields:

| Field         | Type       | Description                              |
|---------------|------------|------------------------------------------|
| \`stepKey\`     | string     | Unique identifier within the workflow    |
| \`description\` | string     | What this step accomplishes              |
| \`dependsOn\`   | string[]   | Step keys this depends on (\`[]\` for root)  |
| \`order\`       | number     | Execution order (1-based integer)        |

Role assignment happens later in the \`specify\` step.

**Complete example:**
\`\`\`bash
${cliEnvPrefix}chatroom workflow create --chatroom-id=<id> --role=<role> --workflow-key=my-workflow << 'JSONEOF'
{
  "steps": [
    { "stepKey": "schema", "description": "Create database schema", "dependsOn": [], "order": 1 },
    { "stepKey": "backend", "description": "Build backend API", "dependsOn": ["schema"], "order": 2 },
    { "stepKey": "tests", "description": "Write and run tests", "dependsOn": ["backend"], "order": 3 }
  ]
}
JSONEOF
\`\`\`

### Specify Step
\`\`\`
${cliEnvPrefix}chatroom workflow specify --chatroom-id=<id> --role=<role> --workflow-key=<key> --step-key=<stepKey> --assignee-role=<role>
\`\`\`
Reads content from stdin with sections:
\`\`\`
---GOAL---
[High-level goal in markdown]
---SKILLS---
[Activate skills the assignee needs before starting work. One command per line.]
${cliEnvPrefix}chatroom skill activate <skill-name> --chatroom-id=<id> --role=<assignee-role>
Available: software-engineering, code-review
---REQUIREMENTS---
[Specific, verifiable outcomes. If this step creates or modifies files, you MUST include the FILE_STRUCTURE section.
When files are created or modified, include:
- Exact file paths
- High-level interfaces (function signatures, exported types)
See FILE_STRUCTURE section below for detailed file specifications.]
---FILE_STRUCTURE--- (include when step creates/modifies files)
[Exact folder structure and files, with each file's purpose and interface]
---WARNINGS---
[Optional: things to avoid]
\`\`\`

### Specification Example

A fully filled-out specification for a step:

\`\`\`bash
${cliEnvPrefix}chatroom workflow specify --chatroom-id=<id> --role=planner --workflow-key=payment-service --step-key=core-service --assignee-role=builder << 'EOF'
---GOAL---
Build the core payment processing service that handles charges and refunds via Stripe.
---SKILLS---
${cliEnvPrefix}chatroom skill activate software-engineering --chatroom-id=<id> --role=builder
---REQUIREMENTS---
- Implement PaymentService class with processPayment and refund methods
- All monetary amounts use integer cents (no floating point)
- Each operation must be idempotent using a client-provided idempotency key
- Write unit tests covering: successful charge, declined card, partial refund, duplicate idempotency key
- Minimum 90% code coverage for the service module
---FILE_STRUCTURE---
src/domain/services/
  payment-service.ts
    - Purpose: Core payment processing logic
    - Exports: PaymentService class
    - Interface: processPayment(params: ChargeParams): Promise<PaymentResult>
    - Interface: refund(params: RefundParams): Promise<RefundResult>
  payment-types.ts
    - Purpose: Shared types for the payment domain
    - Exports: ChargeParams, RefundParams, PaymentResult, RefundResult, PaymentStatus
src/domain/services/__tests__/
  payment-service.test.ts
    - Purpose: Unit tests for PaymentService
    - Tests: successful charge, declined card, partial refund, duplicate idempotency key
---WARNINGS---
- Do NOT store raw card numbers — use Stripe tokens only
- Do NOT use floating point for monetary amounts
EOF
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

### View Step Details
\`\`\`
${cliEnvPrefix}chatroom workflow step-view --chatroom-id=<id> --role=<role> --workflow-key=<key> --step-key=<stepKey>
\`\`\`
Shows the full specification (goal, requirements, warnings) and status of a single step.

### Complete Step
\`\`\`
${cliEnvPrefix}chatroom workflow step-complete --chatroom-id=<id> --role=<role> --workflow-key=<key> --step-key=<stepKey>
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

### Step Design
- Keep steps focused and independently verifiable
- Use meaningful step keys (e.g., "schema", "backend", "tests")

### Specification Quality
- Every step must be specified before it can be completed
- Specify clear requirements so step completion can be objectively verified
- When a step involves creating or modifying files, include the exact folder structure and high-level interfaces in the specification (use the FILE_STRUCTURE section)

### Operations
- Use the status command to monitor progress
- If creation fails, check the error message, fix the JSON, and retry with \`workflow status\` to confirm state
- Exit the workflow with a reason if the plan needs to change
`,
};
