import { groundingPublishCommand } from './command';

export function getGroundingPublishGuidance(params: {
  cliEnvPrefix?: string | undefined;
  chatroomId?: string | undefined;
  role?: string | undefined;
}): string {
  const command = groundingPublishCommand({ ...params, cliEnvPrefix: params.cliEnvPrefix ?? '' });
  return [
    '**Grounding document.** Before you delegate work that involves discovery — any handoff to a specialist, or a change for the `specifier`/`builder` that spans more than one file or surface — publish a grounding document so receiving agents do not repeat the same exploration. Run `chatroom grounding view-template`, fill it, then publish it with the command below. It holds only neutral, observed facts: relevant files, entry points and the observed flow as a sequence diagram. No conclusions, recommendations or design choices. Skip it for conversation-only requests and for single-file edits you have already read, and write `Grounding ID: None.` in the handoff. It is immutable: if your observations change, publish a new one and cite the newest id in the next handoff. The handoff templates include the read command for the recipient.',
    '```bash',
    command,
    '```',
  ].join('\n\n');
}
