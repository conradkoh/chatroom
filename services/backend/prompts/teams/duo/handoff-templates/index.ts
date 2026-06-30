import { getBuilderToPlannerHandoffTemplate } from './builder-to-planner';
import { getPlannerToBuilderHandoffTemplate } from './planner-to-builder';
import { getPlannerToUserReportTemplate } from './planner-to-user';

export interface DuoHandoffTemplateQuery {
  fromRole: string;
  toRole: string;
  nativeIntegration?: boolean;
  chatroomId?: string;
  role?: string;
  cliEnvPrefix?: string;
}

const DUO_HANDOFF_TEMPLATES: Record<string, (query: DuoHandoffTemplateQuery) => string> = {
  'planner:builder': (query) => getPlannerToBuilderHandoffTemplate(query.nativeIntegration),
  'planner:user': (query) =>
    getPlannerToUserReportTemplate({
      chatroomId: query.chatroomId,
      role: query.role,
      cliEnvPrefix: query.cliEnvPrefix,
    }),
  'builder:planner': (query) =>
    getBuilderToPlannerHandoffTemplate({
      chatroomId: query.chatroomId,
      role: query.role,
      cliEnvPrefix: query.cliEnvPrefix,
    }),
};

export function getDuoHandoffTemplate(query: DuoHandoffTemplateQuery): string | null {
  const getter =
    DUO_HANDOFF_TEMPLATES[`${query.fromRole.toLowerCase()}:${query.toRole.toLowerCase()}`];
  return getter?.(query) ?? null;
}
