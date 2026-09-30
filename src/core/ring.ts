import { createHasher, type HashFunction } from './hasher.js';
import type {
  ConsistentHashRingOptions,
  DistributionStats,
  MigrationPlan,
  PhysicalServer,
  RingToken,
  ServerStats,
  VirtualNode,
} from './types.js';

/**
 * Consistent hash ring with virtual node replication.
 * Distributes keys across a ring of tokens using clockwise binary search.
 */
export class ConsistentHashRing {
  private readonly defaultVnodes: number;
  private readonly hasher: HashFunction;
  private readonly servers: Map<string, PhysicalServer> = new Map();
  private readonly vnodes: Map<string, VirtualNode> = new Map();
  public tokens: RingToken[] = [];
  public readonly keys: Map<number, { data?: any; serverId: string; token: number }> = new Map();

  constructor(options?: ConsistentHashRingOptions) {
    this.defaultVnodes = options?.defaultVnodes ?? 100;
    if (this.defaultVnodes <= 0 || !Number.isInteger(this.defaultVnodes)) {
      throw new Error('defaultVnodes must be a positive integer');
    }
    this.hasher = createHasher(options?.hashAlgorithm ?? 'md5');
  }

  /**
   * Adds a physical server to the ring with virtual node replicas.
   * Throws if the server already exists.
   *
   * @param serverId - Unique identifier for the physical server.
   * @param vnodeCount - Number of virtual node replicas. Defaults to configured defaultVnodes.
   * @param metadata - Optional metadata associated with the physical server.
   */
  addServer(serverId: string, vnodeCount?: number, metadata?: Record<string, unknown>): void {
    if (!serverId || serverId.trim() === '') {
      throw new Error('Server ID cannot be empty');
    }
    if (this.servers.has(serverId)) {
      throw new Error(`Server '${serverId}' already exists in ring`);
    }

    const count = vnodeCount ?? this.defaultVnodes;
    if (count <= 0 || !Number.isInteger(count)) {
      throw new Error('vnodeCount must be a positive integer');
    }

    const server: PhysicalServer = { id: serverId, metadata };
    this.servers.set(serverId, server);

    const existingTokens = new Set(this.tokens.map((t) => t.token));

    for (let i = 0; i < count; i++) {
      const vnodeId = `${serverId}#${i}`;
      let token = this.hasher(vnodeId);
      while (existingTokens.has(token)) {
        token = (token + 1) >>> 0;
      }
      existingTokens.add(token);

      const vnode: VirtualNode = {
        vnodeId,
        serverId,
        replicaIndex: i,
        token,
      };
      this.vnodes.set(vnodeId, vnode);
      this.tokens.push({
        token,
        serverId,
        vnodeId,
      });
    }

    this.tokens.sort((a, b) => a.token - b.token);

    // Rebalance existing keys to reflect new ring topology
    for (const [key, entry] of this.keys.entries()) {
      const match = this.getNode(key);
      if (match) {
        entry.serverId = match.server.id;
      }
    }
  }

  /**
   * Removes a physical server and all its virtual nodes from the ring.
   * Reallocates keys belonging to the removed server to their new clockwise owners.
   *
   * @param serverId - Unique identifier of the server to remove.
   * @returns Object containing the reallocated keys and their new server assignments.
   */
  removeServer(serverId: string): { reallocatedKeys: { key: number; newServerId: string | null }[] } {
    if (!this.servers.has(serverId)) {
      throw new Error(`Server '${serverId}' does not exist in ring`);
    }

    this.servers.delete(serverId);

    for (const [vnodeId, vnode] of this.vnodes.entries()) {
      if (vnode.serverId === serverId) {
        this.vnodes.delete(vnodeId);
      }
    }

    this.tokens = this.tokens.filter((t) => t.serverId !== serverId);

    const reallocatedKeys: { key: number; newServerId: string | null }[] = [];
    const remainingServers = this.servers.size;

    for (const [key, entry] of this.keys.entries()) {
      if (entry.serverId === serverId) {
        if (remainingServers > 0) {
          const match = this.getNode(key);
          const newServerId = match ? match.server.id : null;
          if (newServerId !== null) {
            entry.serverId = newServerId;
          } else {
            this.keys.delete(key);
          }
          reallocatedKeys.push({ key, newServerId });
        } else {
          this.keys.delete(key);
          reallocatedKeys.push({ key, newServerId: null });
        }
      }
    }

    return { reallocatedKeys };
  }

  /**
   * Checks whether a physical server exists in the ring.
   */
  hasServer(serverId: string): boolean {
    return this.servers.has(serverId);
  }

  /**
   * Returns all physical servers currently in the ring.
   */
  getServers(): PhysicalServer[] {
    return Array.from(this.servers.values()).map((s) => ({ ...s }));
  }

  /**
   * Returns all virtual nodes currently registered on the ring.
   */
  getVnodes(): VirtualNode[] {
    return Array.from(this.vnodes.values()).map((v) => ({ ...v }));
  }

  /**
   * Finds the server and virtual node responsible for the specified key using clockwise binary search.
   * Wraps around to index 0 if keyToken exceeds the maximum token on the ring.
   *
   * @param key - The key (string or number) to locate on the ring.
   * @returns The resolved physical server, virtual node, and key hash token, or null if ring is empty.
   */
  getNode(key: string | number): { server: PhysicalServer; vnode: VirtualNode; keyToken: number } | null {
    if (this.tokens.length === 0) {
      return null;
    }

    const keyToken = this.hasher(key);

    // If keyToken is strictly greater than the maximum token, wrap around clockwise to index 0
    if (keyToken > this.tokens[this.tokens.length - 1].token) {
      const matchedToken = this.tokens[0];
      const server = this.servers.get(matchedToken.serverId)!;
      const vnode = this.vnodes.get(matchedToken.vnodeId)!;
      return {
        server: { ...server },
        vnode: { ...vnode },
        keyToken,
      };
    }

    // Binary search for smallest token >= keyToken
    let low = 0;
    let high = this.tokens.length - 1;
    let targetIndex = high;

    while (low <= high) {
      const mid = (low + high) >>> 1;
      if (this.tokens[mid].token >= keyToken) {
        targetIndex = mid;
        high = mid - 1;
      } else {
        low = mid + 1;
      }
    }

    const matchedToken = this.tokens[targetIndex];
    const server = this.servers.get(matchedToken.serverId)!;
    const vnode = this.vnodes.get(matchedToken.vnodeId)!;

    return {
      server: { ...server },
      vnode: { ...vnode },
      keyToken,
    };
  }

  /**
   * Stores a data item by numeric key, mapping it to its clockwise owner server.
   *
   * @param key - Numeric key to store.
   * @param data - Optional data payload associated with the key.
   * @returns Placement details including serverId, vnodeId, and computed hash token.
   */
  addData(key: number, data?: any): { serverId: string; vnodeId: string; token: number } {
    if (this.servers.size === 0 || this.tokens.length === 0) {
      throw new Error('Cannot add data: ring has no active servers');
    }

    const match = this.getNode(key);
    if (!match) {
      throw new Error('Failed to resolve server node for key');
    }

    this.keys.set(key, {
      data,
      serverId: match.server.id,
      token: match.keyToken,
    });

    return {
      serverId: match.server.id,
      vnodeId: match.vnode.vnodeId,
      token: match.keyToken,
    };
  }

  /**
   * Retrieves data record by numeric key.
   *
   * @param key - Numeric key to lookup.
   * @returns The stored entry or null if not found.
   */
  getData(key: number): { key: number; serverId: string; data?: any } | null {
    const entry = this.keys.get(key);
    if (!entry) {
      return null;
    }
    return {
      key,
      serverId: entry.serverId,
      data: entry.data,
    };
  }

  /**
   * Removes a data key from the ring storage.
   *
   * @param key - Numeric key to remove.
   * @returns True if key was present and removed, false otherwise.
   */
  removeData(key: number): boolean {
    return this.keys.delete(key);
  }

  /**
   * Returns all data entries currently stored across all servers.
   */
  getAllData(): { key: number; serverId: string; data?: any }[] {
    return Array.from(this.keys.entries()).map(([key, entry]) => ({
      key,
      serverId: entry.serverId,
      data: entry.data,
    }));
  }

  /**
   * Returns all numeric keys assigned to a specific server.
   * Throws if server does not exist.
   *
   * @param serverId - The server identifier to query.
   */
  getServerData(serverId: string): number[] {
    if (!this.servers.has(serverId)) {
      throw new Error(`Server '${serverId}' does not exist in ring`);
    }
    const result: number[] = [];
    for (const [key, entry] of this.keys.entries()) {
      if (entry.serverId === serverId) {
        result.push(key);
      }
    }
    return result;
  }

  /**
   * Calculates key distribution metrics across all physical servers in the ring.
   * Computes per-server counts, percentage share, standard deviation, and peak-to-average load ratio.
   */
  getDistributionStats(): DistributionStats {
    const totalServers = this.servers.size;
    const totalVnodes = this.vnodes.size;
    const totalKeys = this.keys.size;

    if (totalServers === 0) {
      return {
        totalServers: 0,
        totalVnodes: 0,
        totalKeys: 0,
        serverStats: [],
        stdDev: 0,
        loadRatio: 0,
      };
    }

    const serverKeyCounts = new Map<string, number>();
    const serverVnodeCounts = new Map<string, number>();

    for (const serverId of this.servers.keys()) {
      serverKeyCounts.set(serverId, 0);
      serverVnodeCounts.set(serverId, 0);
    }

    for (const entry of this.keys.values()) {
      const current = serverKeyCounts.get(entry.serverId) ?? 0;
      serverKeyCounts.set(entry.serverId, current + 1);
    }

    for (const vnode of this.vnodes.values()) {
      const current = serverVnodeCounts.get(vnode.serverId) ?? 0;
      serverVnodeCounts.set(vnode.serverId, current + 1);
    }

    const serverStats: ServerStats[] = Array.from(this.servers.values()).map((server) => {
      const keyCount = serverKeyCounts.get(server.id) ?? 0;
      const vnodeCount = serverVnodeCounts.get(server.id) ?? 0;
      const loadPercentage = totalKeys > 0 ? (keyCount / totalKeys) * 100 : 0;
      return {
        serverId: server.id,
        vnodeCount,
        keyCount,
        loadPercentage,
      };
    });

    const meanKeys = totalKeys / totalServers;
    const variance =
      serverStats.reduce((sum, s) => sum + Math.pow(s.keyCount - meanKeys, 2), 0) /
      totalServers;
    const stdDev = Math.sqrt(variance);

    const maxKeyCount = Math.max(...serverStats.map((s) => s.keyCount), 0);
    const loadRatio = totalKeys > 0 && meanKeys > 0 ? maxKeyCount / meanKeys : 0;

    return {
      totalServers,
      totalVnodes,
      totalKeys,
      serverStats,
      stdDev,
      loadRatio,
    };
  }

  /**
   * Simulates adding a new server with virtual nodes to the current ring without modifying state.
   * Identifies which existing keys would migrate from their current server to the candidate server.
   *
   * @param newServerId - Identifier for the prospective new server.
   * @param vnodes - Number of virtual nodes to simulate. Defaults to defaultVnodes.
   * @returns MigrationPlan with the list of keys that would move and migration percentage.
   */
  simulateAddition(newServerId: string, vnodes?: number): MigrationPlan {
    if (!newServerId || newServerId.trim() === '') {
      throw new Error('Server ID cannot be empty');
    }
    if (this.servers.has(newServerId)) {
      throw new Error(`Server '${newServerId}' already exists in ring`);
    }

    const count = vnodes ?? this.defaultVnodes;
    if (count <= 0 || !Number.isInteger(count)) {
      throw new Error('vnodeCount must be a positive integer');
    }

    if (this.keys.size === 0) {
      return {
        targetServerId: newServerId,
        movedKeys: [],
        totalMoved: 0,
        percentageMoved: 0,
      };
    }

    const existingTokenSet = new Set(this.tokens.map((t) => t.token));
    const simTokens: RingToken[] = [...this.tokens];

    for (let i = 0; i < count; i++) {
      const vnodeId = `${newServerId}#${i}`;
      let token = this.hasher(vnodeId);
      while (existingTokenSet.has(token)) {
        token = (token + 1) >>> 0;
      }
      existingTokenSet.add(token);

      simTokens.push({
        token,
        serverId: newServerId,
        vnodeId,
      });
    }

    simTokens.sort((a, b) => a.token - b.token);

    const movedKeys: { key: number; fromServer: string; toServer: string }[] = [];
    const maxToken = simTokens[simTokens.length - 1].token;

    for (const [key, entry] of this.keys.entries()) {
      const keyToken = entry.token;
      let matchedServerId: string;

      if (keyToken > maxToken) {
        matchedServerId = simTokens[0].serverId;
      } else {
        let low = 0;
        let high = simTokens.length - 1;
        let targetIndex = high;

        while (low <= high) {
          const mid = (low + high) >>> 1;
          if (simTokens[mid].token >= keyToken) {
            targetIndex = mid;
            high = mid - 1;
          } else {
            low = mid + 1;
          }
        }

        matchedServerId = simTokens[targetIndex].serverId;
      }

      if (matchedServerId === newServerId) {
        movedKeys.push({
          key,
          fromServer: entry.serverId,
          toServer: newServerId,
        });
      }
    }

    const totalMoved = movedKeys.length;
    const percentageMoved = this.keys.size > 0 ? (totalMoved / this.keys.size) * 100 : 0;

    return {
      targetServerId: newServerId,
      movedKeys,
      totalMoved,
      percentageMoved,
    };
  }
}
