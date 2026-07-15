import type { Doc, Id } from '../../_generated/dataModel';

export function isAgenticQueryHarnessSession(
  session: Doc<'chatroom_harnessSessions'>
): session is Doc<'chatroom_harnessSessions'> & {
  purpose: 'agentic-query';
  agenticQueryId: Id<'chatroom_agenticQueries'>;
} {
  return session.purpose === 'agentic-query' && session.agenticQueryId !== undefined;
}
