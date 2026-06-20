import { getBuilderToPlannerHandoffTemplate } from './builder-to-planner';
import { getPlannerToBuilderHandoffTemplate } from './planner-to-builder';
import { getPlannerToUserReportTemplate } from './planner-to-user';

export interface DuoHandoffTemplateQuery {
  fromRole: string;
  toRole: string;
}

const DUO_HANDOFF_TEMPLATES: Record<string, () => string> = {
  'planner:builder': getPlannerToBuilderHandoffTemplate,
  'planner:user': getPlannerToUserReportTemplate,
  'builder:planner': getBuilderToPlannerHandoffTemplate,
};

export function getDuoHandoffTemplate(query: DuoHandoffTemplateQuery): string | null {
  const getter =
    DUO_HANDOFF_TEMPLATES[`${query.fromRole.toLowerCase()}:${query.toRole.toLowerCase()}`];
  return getter?.() ?? null;
}
