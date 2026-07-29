import type { StandingInstructionHistoryItem } from './standingInstructionHistory';

export type StandingInstructionsAddSelection =
  | StandingInstructionHistoryItem['id']
  | 'create-new'
  | null;

export type StandingInstructionsDialogView = 'actions' | 'add' | 'edit' | 'history';

export type StandingInstructionsDialogInitialView = 'add' | 'actions';
