export interface ModelOption {
  value: string;
  label: string;
}

export interface ModelGroup {
  providerKey: string;
  providerLabel: string;
  options: ModelOption[];
}

export type ModelSelectTriggerVariant = 'chatroom' | 'harness';

export interface ModelFilterState {
  hiddenModels: string[];
  hiddenProviders: string[];
}
