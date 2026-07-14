// fallow-ignore-next-line unused-export
export const DAEMON_COMMAND_EVENT_TYPES = [
  'agent.requestStart',
  'agent.restart',
  'agent.requestStop',
  'daemon.ping',
  'daemon.gitRefresh',
  'daemon.localAction',
  'daemon.pickFolder',
  'command.run',
  'command.stop',
  'daemon.refreshCapabilities',
] as const;

export type DaemonCommandEventType = (typeof DAEMON_COMMAND_EVENT_TYPES)[number];

export function isDaemonCommandEventType(value: string): value is DaemonCommandEventType {
  return (DAEMON_COMMAND_EVENT_TYPES as readonly string[]).includes(value);
}
