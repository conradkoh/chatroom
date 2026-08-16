import type { BadgeColor } from './shared';

export interface AgentExitedRowDisplay {
  badgeText: 'Exited';
  badgeColor: BadgeColor;
  secondaryInfo: string;
}

/** Humanized secondary text for agent.exited list rows. */
export function getAgentExitedRowDisplay(event: {
  stopReason?: string;
  intentional?: boolean;
  exitCode?: number;
}): AgentExitedRowDisplay {
  let badgeColor: BadgeColor;
  switch (event.stopReason) {
    case 'user.stop':
    case 'platform.team_switch':
    case 'platform.task_start_in_new_session':
    case 'daemon.shutdown':
      badgeColor = 'info';
      break;
    case 'agent_process.exited_clean':
    case 'daemon.respawn':
      badgeColor = 'warning';
      break;
    case 'platform.resume_storm':
    case 'agent_process.crashed':
    case 'agent_process.signal':
      badgeColor = 'error';
      break;
    default:
      badgeColor = event.intentional ? 'warning' : 'error';
      break;
  }

  let reasonLabel: string;
  switch (event.stopReason) {
    case 'platform.task_start_in_new_session':
      reasonLabel = 'for new session';
      break;
    case 'user.stop':
      reasonLabel = 'user stop';
      break;
    case 'platform.team_switch':
      reasonLabel = 'team switch';
      break;
    case 'daemon.shutdown':
      reasonLabel = 'daemon shutdown';
      break;
    case 'agent_process.exited_clean':
      reasonLabel = 'clean exit';
      break;
    case 'daemon.respawn':
      reasonLabel = 'daemon respawn';
      break;
    case 'platform.resume_storm':
      reasonLabel = 'resume storm';
      break;
    case 'agent_process.crashed':
      reasonLabel = 'crash';
      break;
    case 'agent_process.signal':
      reasonLabel = 'signal';
      break;
    case undefined:
    case '':
      reasonLabel = event.intentional ? 'intentional' : 'unknown';
      break;
    default:
      reasonLabel = event.stopReason.replace(/[._]/g, ' ');
      break;
  }

  const exitPrefix = event.exitCode !== undefined ? `exit(${event.exitCode}) · ` : '';
  return {
    badgeText: 'Exited',
    badgeColor,
    secondaryInfo: `${exitPrefix}${reasonLabel}`,
  };
}
