import type { WorkspacePendingDelta } from '../../../infrastructure/services/workspace/workspace-sync-state.js';
import { resolveOutboxDbPath } from './outbox-db-path.js';
import { openDurableFifoQueueStore } from './durable-fifo-queue-store.js';
import { createKeyedFifoBatchedOutboxRegistry, type KeyedFifoBatchedOutboxRegistry } from './keyed-fifo-batched-outbox-registry.js';
export const WORKSPACE_FILE_TREE_DELTA_OUTBOX_BATCH_SIZE=5;
export type DeltaPushResult={status:'applied'|'duplicate'|'conflict';revision:number};
export type WorkspaceFileTreeDeltaDeliveryUnit={delta:WorkspacePendingDelta;baseRevision:number};
export type WorkspaceFileTreeDeltaOutboxRegistry=KeyedFifoBatchedOutboxRegistry<WorkspaceFileTreeDeltaDeliveryUnit,DeltaPushResult>;
export function createWorkspaceFileTreeDeltaOutboxRegistry(machineId:string,createSend:(key:string)=>(unit:WorkspaceFileTreeDeltaDeliveryUnit)=>Promise<DeltaPushResult>,options?:{batchSize?:number;onError?:(key:string,e:unknown)=>void}):WorkspaceFileTreeDeltaOutboxRegistry{const store=openDurableFifoQueueStore(resolveOutboxDbPath(machineId,'file-tree-delta'));return createKeyedFifoBatchedOutboxRegistry({store,batchSize:options?.batchSize??WORKSPACE_FILE_TREE_DELTA_OUTBOX_BATCH_SIZE,createSend:key=>async units=>{const out:DeltaPushResult[]=[];for(const u of units){const r=await createSend(key)(u);out.push(r);if(r.status==='conflict')break;}return out;},serialize:JSON.stringify,deserialize:JSON.parse,onError:options?.onError});}
