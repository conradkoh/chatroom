// fallow-ignore-file complexity unused-class-member
export type RoleStopState = 'idle' | 'pending' | 'stopping' | 'stopped' | 'failed';

export type MachineAgentOperationalRow = {
  chatroomId: string;
  role: string;
  operationalState: 'running' | 'stopped' | 'starting' | 'circuit_open';
  isAlive: boolean;
  isRunning: boolean;
  daemonConnected: boolean;
  revisionKey: string;
  stopState?: RoleStopState | undefined;
};

const roleKey = (chatroomId: string, role: string) => `${chatroomId}:${role.toLowerCase()}`;

export function isOperationalDesiredRunning(row: MachineAgentOperationalRow | undefined): boolean {
  return row?.operationalState === 'running' || row?.operationalState === 'starting';
}

export function isOperationalStopIntentActive(
  row: MachineAgentOperationalRow | undefined
): boolean {
  return (
    row?.stopState === 'stopped' || row?.stopState === 'stopping' || row?.stopState === 'pending'
  );
}

export class AgentOperationalReadModel {
  private readonly rows = new Map<string, MachineAgentOperationalRow>();
  replace(rows: readonly MachineAgentOperationalRow[]): { chatroomId: string; role: string }[] {
    const changed: { chatroomId: string; role: string }[] = [];
    const nextKeys = new Set<string>();
    for (const row of rows) {
      const key = roleKey(row.chatroomId, row.role);
      nextKeys.add(key);
      const prev = this.rows.get(key);
      if (!prev || prev.revisionKey !== row.revisionKey)
        changed.push({ chatroomId: row.chatroomId, role: row.role });
      this.rows.set(key, row);
    }
    for (const [key, prev] of this.rows) {
      if (!nextKeys.has(key)) {
        changed.push({ chatroomId: prev.chatroomId, role: prev.role });
        this.rows.delete(key);
      }
    }
    return changed;
  }
  applySignalPage(
    rows: readonly MachineAgentOperationalRow[],
    removed: readonly { chatroomId: string; role: string }[]
  ): { chatroomId: string; role: string }[] {
    const changed: { chatroomId: string; role: string }[] = [];
    for (const row of rows) {
      const key = roleKey(row.chatroomId, row.role);
      const prev = this.rows.get(key);
      if (!prev || prev.revisionKey !== row.revisionKey) {
        changed.push({ chatroomId: row.chatroomId, role: row.role });
      }
      this.rows.set(key, row);
    }
    for (const item of removed) {
      const key = roleKey(item.chatroomId, item.role);
      if (this.rows.has(key)) changed.push(item);
      this.rows.delete(key);
    }
    return changed;
  }
  get(chatroomId: string, role: string): MachineAgentOperationalRow | undefined {
    return this.rows.get(roleKey(chatroomId, role));
  }
}
