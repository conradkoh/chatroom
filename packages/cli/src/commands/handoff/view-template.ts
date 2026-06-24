import { viewHandoffTemplate } from '@workspace/backend/prompts/cli/handoff/view-template.js';

export interface HandoffViewTemplateOptions {
  role: string;
  nextRole: string;
  teamId?: string;
}

export function printHandoffViewTemplate(options: HandoffViewTemplateOptions): void {
  const template = viewHandoffTemplate({
    role: options.role,
    nextRole: options.nextRole,
    teamId: options.teamId,
    nativeIntegration: true,
  });
  console.log(template);
}
