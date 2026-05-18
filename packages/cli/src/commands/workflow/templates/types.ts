/**
 * Workflow Template Types
 */

export interface TemplateStep {
  stepKey: string;
  description: string;
  dependsOn: string[];
  order: number;
  assigneeRole: string;
  specification?: {
    goal: string;
    requirements: string;
    warnings?: string;
  };
}

export interface WorkflowTemplate {
  key: string;
  steps: TemplateStep[];
}
