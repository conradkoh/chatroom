import { getBuilderToPlannerHandoffTemplate } from './builder-to-planner';
import { getBuilderToReviewerHandoffTemplate } from './builder-to-reviewer';
import { getPlannerToBuilderHandoffTemplate } from './planner-to-builder';
import { getPlannerToReviewerHandoffTemplate } from './planner-to-reviewer';
import { getPlannerToUserReportTemplate } from './planner-to-user';
import { getReviewerToBuilderHandoffTemplate } from './reviewer-to-builder';
import { getReviewerToPlannerHandoffTemplate } from './reviewer-to-planner';
import { getReviewerToUserReportTemplate } from './reviewer-to-user';

export interface SquadHandoffTemplateQuery {
  fromRole: string;
  toRole: string;
}

const SQUAD_HANDOFF_TEMPLATES: Record<string, () => string> = {
  'planner:builder': getPlannerToBuilderHandoffTemplate,
  'planner:user': getPlannerToUserReportTemplate,
  'planner:reviewer': getPlannerToReviewerHandoffTemplate,
  'builder:planner': getBuilderToPlannerHandoffTemplate,
  'builder:reviewer': getBuilderToReviewerHandoffTemplate,
  'reviewer:builder': getReviewerToBuilderHandoffTemplate,
  'reviewer:planner': getReviewerToPlannerHandoffTemplate,
  'reviewer:user': getReviewerToUserReportTemplate,
};

export function getSquadHandoffTemplate(query: SquadHandoffTemplateQuery): string | null {
  const getter =
    SQUAD_HANDOFF_TEMPLATES[`${query.fromRole.toLowerCase()}:${query.toRole.toLowerCase()}`];
  return getter?.() ?? null;
}
