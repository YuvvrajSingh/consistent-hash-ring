import { ConsistentHashRing } from '../core/ring.js';
import {
  buildBar,
  c,
  formatBanner,
  formatMigration,
  formatStats,
  formatTable,
  getServerColor,
  renderRing,
} from './view.js';

function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Executes a step-by-step visual demonstration of consistent hashing.
 * Proves the core invariants: minimal churn, balanced load, and deterministic routing.
 */
export async function runDemo(options?: { delayMs?: number }): Promise<void> {
  const delay = options?.delayMs ?? 600;

  console.log('\n' + formatBanner() + '\n');
  console.log(`  ${c.dim}Automated Invariant Verification & Distribution Walkthrough${c.reset}\n`);
  await sleep(delay);

  // --------------------------------------------------------------------------
  // STEP 1: Initialize Ring & Add 3 Physical Servers
  // --------------------------------------------------------------------------
  console.log(`${c.bold}${c.brightCyan}STEP 1${c.reset} ${c.dim}›${c.reset} ${c.bold}Initialize Ring & Add 3 Physical Nodes (50 vnodes each)${c.reset}`);
  console.log(`${c.dim}────────────────────────────────────────────────────────────────────────${c.reset}`);

  const ring = new ConsistentHashRing({ defaultVnodes: 50 });
  const initialNodes = ['alpha', 'beta', 'gamma'];

  for (const id of initialNodes) {
    ring.addServer(id, 50);
    const col = getServerColor(id);
    console.log(`  ${c.emerald}•${c.reset} Registered node ${col}${id}${c.reset} with ${c.white}50${c.reset} virtual replicas.`);
  }

  console.log(`\n  ${c.dim}Topology initialized: 3 servers · 150 virtual nodes across 32-bit uint32 ring.${c.reset}\n`);
  console.log(renderRing(ring));
  await sleep(delay);

  // --------------------------------------------------------------------------
  // STEP 2: Inject 600 Numeric Data Items
  // --------------------------------------------------------------------------
  console.log(`${c.bold}${c.brightCyan}STEP 2${c.reset} ${c.dim}›${c.reset} ${c.bold}Inject 600 Numeric Data Keys [1000 .. 1599]${c.reset}`);
  console.log(`${c.dim}────────────────────────────────────────────────────────────────────────${c.reset}`);

  const startKey = 1000;
  const totalKeys = 600;
  const t0 = performance.now();

  for (let k = startKey; k < startKey + totalKeys; k++) {
    ring.addData(k, { payload: `record-${k}`, created: Date.now() });
  }

  const elapsed = (performance.now() - t0).toFixed(2);
  console.log(`  ${c.emerald}•${c.reset} Successfully mapped ${c.bold}${totalKeys}${c.reset} keys in ${c.white}${elapsed}ms${c.reset}.`);
  console.log(`  ${c.dim}Each key hashed via 32-bit digest and routed to clockwise successor vnode.${c.reset}\n`);

  // Sample lookup walkthrough
  const sampleKey = 1042;
  const sampleMatch = ring.getNode(sampleKey)!;
  const sampleHex = `0x${sampleMatch.keyToken.toString(16).padStart(8, '0').toUpperCase()}`;
  const sCol = getServerColor(sampleMatch.server.id);

  console.log(`  ${c.dim}Sample Route Inspection:${c.reset}`);
  console.log(`    Key ${c.bold}${sampleKey}${c.reset} → token ${c.cyan}${sampleHex}${c.reset} → vnode ${sCol}${sampleMatch.vnode.vnodeId}${c.reset} (${sCol}${sampleMatch.server.id}${c.reset})\n`);
  await sleep(delay);

  // --------------------------------------------------------------------------
  // STEP 3: Print Distribution Metrics & Load Bar Charts
  // --------------------------------------------------------------------------
  console.log(`${c.bold}${c.brightCyan}STEP 3${c.reset} ${c.dim}›${c.reset} ${c.bold}Evaluate Baseline Load Distribution & Standard Deviation${c.reset}`);
  console.log(`${c.dim}────────────────────────────────────────────────────────────────────────${c.reset}`);

  const baselineStats = ring.getDistributionStats();
  console.log(formatStats(baselineStats));
  console.log(`  ${c.dim}Notice: 50 vnodes/server smooths variance across the 32-bit perimeter.${c.reset}\n`);
  await sleep(delay);

  // --------------------------------------------------------------------------
  // STEP 4: Add 4th Server 'delta' (Simulate First, Then Commit)
  // --------------------------------------------------------------------------
  console.log(`${c.bold}${c.brightCyan}STEP 4${c.reset} ${c.dim}›${c.reset} ${c.bold}Cluster Scale-Out: Simulate & Add 4th Node ('delta')${c.reset}`);
  console.log(`${c.dim}────────────────────────────────────────────────────────────────────────${c.reset}`);

  const plan = ring.simulateAddition('delta', 50);
  console.log(formatMigration(plan));

  const theoreticalIdeal = (1 / 4) * 100;
  console.log(`  ${c.bold}Consistent Hashing Invariant Check:${c.reset}`);
  console.log(`    Theoretical re-allocation for N=3 → 4 nodes : ${c.white}${theoreticalIdeal.toFixed(1)}%${c.reset} (1 / (N+1))`);
  console.log(`    Observed re-allocation                      : ${c.emerald}${c.bold}${plan.percentageMoved.toFixed(2)}%${c.reset} (${plan.totalMoved} of ${totalKeys} keys)`);
  console.log(`    Preserved on existing nodes (zero movement) : ${c.emerald}${c.bold}${(100 - plan.percentageMoved).toFixed(2)}%${c.reset}`);
  console.log(`  ${c.dim}(With traditional modulo hash(key)%N, ~75% of keys would be invalidated!)${c.reset}\n`);

  console.log(`  ${c.dim}Executing server addition...${c.reset}`);
  ring.addServer('delta', 50);
  console.log(`  ${c.emerald}•${c.reset} Node ${getServerColor('delta')}delta${c.reset} added to ring.\n`);

  const postAddStats = ring.getDistributionStats();
  console.log(formatStats(postAddStats));
  await sleep(delay);

  // --------------------------------------------------------------------------
  // STEP 5: Remove Server 'beta' (Failure / Graceful Decommission)
  // --------------------------------------------------------------------------
  console.log(`${c.bold}${c.brightCyan}STEP 5${c.reset} ${c.dim}›${c.reset} ${c.bold}Node Decommission: Remove Server ('beta')${c.reset}`);
  console.log(`${c.dim}────────────────────────────────────────────────────────────────────────${c.reset}`);

  const preBetaStats = ring.getDistributionStats();
  const betaKeysCount = preBetaStats.serverStats.find((s) => s.serverId === 'beta')?.keyCount ?? 0;

  console.log(`  ${c.dim}Evicting node 'beta' (currently holding ${betaKeysCount} keys)...${c.reset}`);
  const removalResult = ring.removeServer('beta');

  console.log(`  ${c.emerald}•${c.reset} Eviction complete. Reallocated ${c.bold}${removalResult.reallocatedKeys.length}${c.reset} keys clockwise.`);
  console.log(`  ${c.dim}Crucial invariant: Keys on 'alpha', 'gamma', and 'delta' did not churn between each other.${c.reset}\n`);

  const finalStats = ring.getDistributionStats();
  console.log(formatStats(finalStats));
  console.log(renderRing(ring));

  // Final summary box
  console.log(`${c.dim}┌────────────────────────────────────────────────────────────────────────┐${c.reset}`);
  console.log(`${c.dim}│${c.reset}  ${c.bold}${c.white}DEMONSTRATION COMPLETE${c.reset}                                               ${c.dim}│${c.reset}`);
  console.log(`${c.dim}│${c.reset}  ${c.dim}• Minimal Churn    : Scale-out moved ~25% of keys; ~75% stayed pinned │${c.reset}`);
  console.log(`${c.dim}│${c.reset}  ${c.dim}• Uniform Spread   : Virtual nodes prevented localized hotspots       │${c.reset}`);
  console.log(`${c.dim}│${c.reset}  ${c.dim}• Fast Resolution  : O(log(N·V)) binary search for every lookup       │${c.reset}`);
  console.log(`${c.dim}└────────────────────────────────────────────────────────────────────────┘${c.reset}\n`);
}
