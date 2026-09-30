/**
 * Type definitions for the consistent hash ring engine.
 */

export type HashAlgorithm = 'md5' | 'sha256' | 'murmur3';

export interface PhysicalServer {
  id: string;
  metadata?: Record<string, unknown>;
}

export interface VirtualNode {
  vnodeId: string;
  serverId: string;
  replicaIndex: number;
  token: number;
}

export interface RingToken {
  token: number;
  serverId: string;
  vnodeId: string;
}

export interface ServerStats {
  serverId: string;
  vnodeCount: number;
  keyCount: number;
  loadPercentage: number;
}

export interface DistributionStats {
  totalServers: number;
  totalVnodes: number;
  totalKeys: number;
  serverStats: ServerStats[];
  stdDev: number;
  loadRatio: number;
}

export interface MovedKey {
  key: number;
  fromServer: string;
  toServer: string;
}

export interface MigrationPlan {
  targetServerId: string;
  movedKeys: MovedKey[];
  totalMoved: number;
  percentageMoved: number;
}

export interface ConsistentHashRingOptions {
  defaultVnodes?: number;
  hashAlgorithm?: HashAlgorithm;
}

export interface StoredDataEntry<T = unknown> {
  key: number;
  serverId: string;
  token: number;
  data?: T;
}

export interface NodeLookupResult {
  server: PhysicalServer;
  vnode: VirtualNode;
  keyToken: number;
}

export interface AddDataResult {
  serverId: string;
  vnodeId: string;
  token: number;
}

export interface DataRecord<T = unknown> {
  key: number;
  serverId: string;
  data?: T;
}

export interface ReallocatedKey {
  key: number;
  newServerId: string | null;
}

export interface RemoveServerResult {
  reallocatedKeys: ReallocatedKey[];
}
