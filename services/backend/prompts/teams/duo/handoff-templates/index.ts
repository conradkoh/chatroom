import { getBuilderToPlannerHandoffTemplate } from './builder-to-planner';
import { getPlannerToBuilderHandoffTemplate } from './planner-to-builder';
import { getPlannerToUserReportTemplate } from './planner-to-user';

export interface DuoHandoffTemplateQuery {
  fromRole: string;
  toRole: string;
  nativeIntegration?: boolean;
}

const DUO_HANDOFF_TEMPLATES: Record<string, (nativeIntegration?: boolean) => string> = {
  'planner:builder': getPlannerToBuilderHandoffTemplate,
  'planner:user': () => getPlannerToUserReportTemplate(),
  'builder:planner': () => getBuilderToPlannerHandoffTemplate(),
};

export function getDuoHandoffTemplate(query: DuoHandoffTemplateQuery): string | null {
  const getter =
    DUO_HANDOFF_TEMPLATES[`${query.fromRole.toLowerCase()}:${query.toRole.toLowerCase()}`];
  return getter?.(query.nativeIntegration) ?? null;
}
