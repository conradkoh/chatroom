prompts/
├── phases/ # Phase-based organization
│ ├── agent-initialization/  
│ │ ├── base-sections.ts
│ │ ├── getting-started.ts
│ │ ├── communication.ts
│ │ ├── roles/ # 🆕 Domain-specific role separation
│ │ │ ├── builder.ts # Builder-specific workflow
│ │ │ ├── reviewer.ts # Reviewer-specific workflow
│ │ │ └── index.ts # Role aggregator
│ │ └── index.ts
│ ├── task-reception/  
│ │ ├── message-received.ts
│ │ ├── classification/ # 🆕 Classification domain
│ │ │ ├── question.ts # Question classification guidance
│ │ │ ├── new-feature.ts # New feature classification guidance
│ │ │ ├── follow-up.ts # Follow-up classification guidance
│ │ │ └── index.ts
│ │ ├── next-steps.ts
│ │ └── index.ts
│ ├── task-execution/  
│ │ ├── workflow-guidance.ts
│ │ ├── progress-tracking.ts
│ │ └── index.ts
│ └── task-completion/  
│ ├── handoff/ # 🆕 Handoff domain separation
│ │ ├── procedures.ts # General handoff procedures
│ │ ├── to-reviewer.ts # Handoff to reviewer specific
│ │ ├── to-user.ts # Handoff to user specific
│ │ └── index.ts
│ ├── completion-summary.ts
│ └── index.ts
├── cli-commands/ # CLI-specific prompts
│ ├── task-started/
│ │ ├── main-prompt.ts
│ │ ├── classification/ # 🆕 CLI classification separation
│ │ │ ├── question.ts # CLI question classification
│ │ │ ├── new-feature.ts # CLI new feature classification
│ │ │ ├── follow-up.ts # CLI follow-up classification
│ │ │ └── index.ts
│ │ ├── usage-examples.ts
│ │ ├── validation-rules.ts
│ │ └── index.ts
│ ├── handoff/
│ │ ├── main-prompt.ts
│ │ ├── handoff-types/ # 🆕 Handoff type separation
│ │ │ ├── feedback.ts # Feedback handoff prompts
│ │ │ ├── approval.ts # Approval handoff prompts
│ │ │ └── index.ts
│ │ ├── usage-examples.ts
│ │ ├── validation-rules.ts
│ │ └── index.ts
│ ├── wait-for-task/
│ │ ├── main-prompt.ts
│ │ ├── session-management.ts
│ │ ├── error-handling.ts
│ │ └── index.ts
│ └── index.ts
├── lifecycle-events/ # Event-specific prompts
│ ├── wait-for-task/
│ │ ├── task-received.ts
│ │ ├── session-completed.ts
│ │ ├── error-recovery.ts
│ │ └── index.ts
│ ├── task-delivery/
│ │ ├── message-context.ts
│ │ ├── classification-required.ts
│ │ ├── next-commands/
│ │ │ ├── task-started.ts # 🆕 Task-started next steps
│ │ │ ├── handoff.ts # 🆕 Handoff next steps
│ │ │ └── index.ts
│ │ ├── json-output.ts
│ │ └── index.ts
│ └── handoff-completed/
│ ├── acknowledgment.ts
│ ├── next-assignment.ts
│ └── index.ts
├── reference/ # Reference materials
│ ├── guidelines/
│ │ ├── coding-review.ts
│ │ ├── security-policy.ts
│ │ ├── design-guidelines.ts
│ │ ├── performance-guidelines.ts
│ │ └── index.ts
│ ├── policies/
│ │ ├── security.ts
│ │ ├── design.ts
│ │ ├── performance.ts
│ │ └── index.ts
│ ├── templates/
│ │ ├── role-templates/
│ │ │ ├── builder.ts # 🆕 Builder template
│ │ │ ├── reviewer.ts # 🆕 Reviewer template
│ │ │ └── index.ts
│ │ ├── prompt-templates.ts
│ │ └── index.ts
│ └── workflows/ # 🆕 Workflow reference
│ ├── development.ts # Development workflow
│ ├── review.ts # Review workflow
│ └── index.ts
├── shared/ # Shared utilities
│ ├── config.ts
│ ├── formatters.ts
│ ├── types.ts
│ └── index.ts
├── generator.ts # Main prompt generator
├── index.ts # Main exports
└── README.md
