import { getSoloToUserReportTemplate } from './solo-to-user';

export interface SoloHandoffTemplateQuery {
  fromRole: string;
  toRole: string;
  chatroomId?: string;
  role?: string;
  cliEnvPrefix?: string;
}

const SOLO_HANDOFF_TEMPLATES: Record<string, (query: SoloHandoffTemplateQuery) => string> = {
  'solo:user': (query) =>
    getSoloToUserReportTemplate({
      chatroomId: query.chatroomId,
      role: query.role,
      cliEnvPrefix: query.cliEnvPrefix,
    }),
};

export function getSoloHandoffTemplate(query: SoloHandoffTemplateQuery): string | null {
  const getter =
    SOLO_HANDOFF_TEMPLATES[`${query.fromRole.toLowerCase()}:${query.toRole.toLowerCase()}`];
  return getter?.(query) ?? null;
}
