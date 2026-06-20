import { getSoloToUserReportTemplate } from './solo-to-user';

export interface SoloHandoffTemplateQuery {
  fromRole: string;
  toRole: string;
}

const SOLO_HANDOFF_TEMPLATES: Record<string, () => string> = {
  'solo:user': getSoloToUserReportTemplate,
};

export function getSoloHandoffTemplate(query: SoloHandoffTemplateQuery): string | null {
  const getter =
    SOLO_HANDOFF_TEMPLATES[`${query.fromRole.toLowerCase()}:${query.toRole.toLowerCase()}`];
  return getter?.() ?? null;
}
