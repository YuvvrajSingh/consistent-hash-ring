import assert from 'node:assert';
import { ConsistentHashRing, hashKey, murmurHash3, createHasher } from '../core/index.js';

// Minimalist developer test harness (zero external dependencies)
interface TestContext {
  suiteName: string;
  passed: number;
  failed: number;
  totalDurationMs: number;
}

const ctx: TestContext = {
  suiteName: '',
  passed: 0,
  failed: 0,
  totalDurationMs: 0,
};

function suite(name: string, fn: () => void): void {
  ctx.suiteName = name;
  console.log(`\n\x1b[1m\x1b[36m■ Test Suite:\x1b[0m \x1b[1m${name}\x1b[0m`);
  const start = performance.now();
  try {
    fn();
    const duration = performance.now() - start;
    ctx.totalDurationMs += duration;
    console.log(`  \x1b[90m↳ Suite completed in ${duration.toFixed(2)}ms\x1b[0m`);
  } catch (err) {
    const duration = performance.now() - start;
    ctx.totalDurationMs += duration;
    console.error(`  \x1b[31m✖ Suite failure in "${name}":\x1b[0m`, err);
    throw err;
  }
}

function test(description: string, fn: () => void): void {
  const t0 = performance.now();
  try {
    fn();
    const elapsed = performance.now() - t0;
    ctx.passed++;
    console.log(`  \x1b[32m·\x1b[0m ${description} \x1b[90m(${elapsed.toFixed(2)}ms)\x1b[0m`);
  } catch (err) {
    ctx.failed++;
    console.error(`  \x1b[31m✖ ${description}\x1b[0m`);
    throw err;
  }
}

console.log(`\x1b[1m\x1b[37m=================================================================\x1b[0m`);
console.log(`\x1b[1m\x1b[37m  CONSISTENT HASH RING — VERIFICATION SUITE\x1b[0m`);
console.log(`\x1b[90m  Pure Node.js / TypeScript Invariant & Distribution Testing\x1b[0m`);
console.log(`\x1b[1m\x1b[37m=================================================================\x1b[0m`);

// =====================================================================
// Suite 1: Ring Initialization & Option Defaults
// =====================================================================
suite('Ring Initialization & Option Defaults', () => {
  test('initializes with default options (100 vnodes, md5 hash)', () => {
    const ring = new ConsistentHashRing();
    assert.strictEqual(ring.tokens.length, 0, 'Tokens array must be empty');
    assert.strictEqual(ring.getServers().length, 0, 'Servers list must be empty');
    assert.strictEqual(ring.getVnodes().length, 0, 'Vnodes list must be empty');
    assert.strictEqual(ring.keys.size, 0, 'Keys map must be empty');

    // Default vnodes count applies when server is added without count
    ring.addServer('srv-default');
    assert.strictEqual(ring.getVnodes().length, 100, 'Must create 100 vnodes by default');
    assert.strictEqual(ring.tokens.length, 100, 'Must create 100 tokens by default');
  });

  test('accepts custom defaultVnodes option', () => {
    const ring = new ConsistentHashRing({ defaultVnodes: 42 });
    ring.addServer('srv-custom');
    assert.strictEqual(ring.getVnodes().length, 42, 'Must create 42 vnodes per configured default');
  });

  test('accepts distinct hash algorithms (md5, sha256, murmur3)', () => {
    const ringMd5 = new ConsistentHashRing({ hashAlgorithm: 'md5' });
    const ringSha = new ConsistentHashRing({ hashAlgorithm: 'sha256' });
    const ringMurmur = new ConsistentHashRing({ hashAlgorithm: 'murmur3' });

    ringMd5.addServer('srv');
    ringSha.addServer('srv');
    ringMurmur.addServer('srv');

    assert.strictEqual(ringMd5.tokens.length, 100);
    assert.strictEqual(ringSha.tokens.length, 100);
    assert.strictEqual(ringMurmur.tokens.length, 100);
  });

  test('rejects non-positive and non-integer defaultVnodes', () => {
    assert.throws(() => new ConsistentHashRing({ defaultVnodes: 0 }), /positive integer/);
    assert.throws(() => new ConsistentHashRing({ defaultVnodes: -10 }), /positive integer/);
    assert.throws(() => new ConsistentHashRing({ defaultVnodes: 12.5 }), /positive integer/);
  });
});

// =====================================================================
// Suite 2: Deterministic Hashing
// =====================================================================
suite('Deterministic Hashing', () => {
  test('hashes identically across repeated invocations', () => {
    const key = 'node-alpha-42';
    const first = hashKey(key);
    for (let i = 0; i < 500; i++) {
      assert.strictEqual(hashKey(key), first, 'Hash must be strictly deterministic');
    }
  });

  test('all hash algorithms produce deterministic uint32 values in [0, 2^32 - 1]', () => {
    const algorithms = ['md5', 'sha256', 'murmur3'] as const;
    for (const algo of algorithms) {
      for (let i = 0; i < 200; i++) {
        const val = `sample-key-${i}`;
        const token = hashKey(val, algo);
        assert(Number.isInteger(token), `${algo} token must be an integer`);
        assert(token >= 0, `${algo} token must be non-negative`);
        assert(token <= 0xffffffff, `${algo} token must not exceed 2^32 - 1`);
      }
    }
  });

  test('numeric keys produce identical hashes to stringified equivalents', () => {
    const samples = [0, 1, 42, 999999, 1000000000];
    for (const num of samples) {
      assert.strictEqual(hashKey(num), hashKey(String(num)), `Numeric ${num} must match string "${num}"`);
      assert.strictEqual(hashKey(num, 'murmur3'), hashKey(String(num), 'murmur3'));
      assert.strictEqual(hashKey(num, 'sha256'), hashKey(String(num), 'sha256'));
    }
  });

  test('createHasher factory creates properly bound hash functions', () => {
    const md5Fn = createHasher('md5');
    const shaFn = createHasher('sha256');
    const murmurFn = createHasher('murmur3');

    assert.strictEqual(md5Fn('test-input'), hashKey('test-input', 'md5'));
    assert.strictEqual(shaFn('test-input'), hashKey('test-input', 'sha256'));
    assert.strictEqual(murmurFn('test-input'), hashKey('test-input', 'murmur3'));
  });

  test('murmurHash3 handles diverse string lengths, offsets, and boundary UTF-8 bytes', () => {
    const sampleStrings = ['', 'a', 'ab', 'abc', 'abcd', 'abcde', 'longer-string-with-accent-é-ñ-ü'];
    for (const str of sampleStrings) {
      const h1 = murmurHash3(str);
      const h2 = murmurHash3(str);
      assert.strictEqual(h1, h2, 'Murmur3 must be deterministic for arbitrary UTF-8');
      assert(h1 >= 0 && h1 <= 0xffffffff);
    }
  });
});

// =====================================================================
// Suite 3: Clockwise Binary Search
// =====================================================================
suite('Clockwise Binary Search', () => {
  test('resolves exact match when key hash coincides with a vnode token', () => {
    const ring = new ConsistentHashRing({ defaultVnodes: 5 });
    ring.addServer('srv-alpha');

    // Pick an existing token from the ring
    const sampleToken = ring.tokens[2];
    // Find key that hashes to token or directly inspect binary search mechanics
    const match = ring.getNode(sampleToken.vnodeId);
    assert(match !== null);
    assert.strictEqual(match.keyToken, sampleToken.token);
    assert.strictEqual(match.vnode.vnodeId, sampleToken.vnodeId);
    assert.strictEqual(match.server.id, 'srv-alpha');
  });

  test('wraps around to index 0 when key hash exceeds the maximum token on ring', () => {
    const ring = new ConsistentHashRing({ defaultVnodes: 10 });
    ring.addServer('srv-alpha');
    ring.addServer('srv-beta');

    const maxToken = ring.tokens[ring.tokens.length - 1].token;
    const minToken = ring.tokens[0];

    // Find a key whose hash > maxToken, or construct scenario
    // Since tokens are random in uint32, search a few integer keys to find one > maxToken
    let wrapKey: string | null = null;
    for (let i = 0; i < 10000; i++) {
      const candidate = `wrap-check-${i}`;
      if (hashKey(candidate) > maxToken) {
        wrapKey = candidate;
        break;
      }
    }

    if (wrapKey !== null) {
      const match = ring.getNode(wrapKey);
      assert(match !== null);
      assert.strictEqual(
        match.vnode.vnodeId,
        minToken.vnodeId,
        'Key exceeding maxToken must wrap around clockwise to the lowest token (index 0)'
      );
      assert.strictEqual(match.server.id, minToken.serverId);
    }
  });

  test('resolves to the immediate clockwise successor between two tokens', () => {
    const ring = new ConsistentHashRing({ defaultVnodes: 20 });
    ring.addServer('srv-1');
    ring.addServer('srv-2');

    // For any random key, verify the resolved token is indeed the smallest token >= keyToken (or index 0 on wrap)
    for (let i = 0; i < 200; i++) {
      const key = `lookup-key-${i}`;
      const kToken = hashKey(key);
      const match = ring.getNode(key);
      assert(match !== null);

      const maxToken = ring.tokens[ring.tokens.length - 1].token;
      if (kToken > maxToken) {
        assert.strictEqual(match.vnode.vnodeId, ring.tokens[0].vnodeId);
      } else {
        // Must be the first token >= kToken
        const expectedIndex = ring.tokens.findIndex((t) => t.token >= kToken);
        assert.strictEqual(match.vnode.vnodeId, ring.tokens[expectedIndex].vnodeId);
        assert(match.vnode.token >= kToken);
      }
    }
  });

  test('single-server ring maps 100% of keys to that sole server regardless of token value', () => {
    const ring = new ConsistentHashRing({ defaultVnodes: 25 });
    ring.addServer('lone-server');

    for (let k = 0; k < 300; k++) {
      const match = ring.getNode(`item-${k}`);
      assert(match !== null);
      assert.strictEqual(match.server.id, 'lone-server');
    }
  });
});

// =====================================================================
// Suite 4: Server Add & Remove
// =====================================================================
suite('Server Add & Remove', () => {
  test('adds servers with specified vnode counts and maintains sorted tokens', () => {
    const ring = new ConsistentHashRing();
    ring.addServer('s1', 30, { region: 'us-west' });
    ring.addServer('s2', 50, { region: 'eu-central' });
    ring.addServer('s3', 20, { region: 'ap-south' });

    assert.strictEqual(ring.getServers().length, 3);
    assert.strictEqual(ring.getVnodes().length, 100);
    assert.strictEqual(ring.tokens.length, 100);

    // Verify metadata preservation
    const servers = ring.getServers();
    const s1 = servers.find((s) => s.id === 's1');
    assert.deepStrictEqual(s1?.metadata, { region: 'us-west' });

    // Verify strictly ascending tokens
    for (let i = 1; i < ring.tokens.length; i++) {
      assert(
        ring.tokens[i].token > ring.tokens[i - 1].token,
        `Token at index ${i} (${ring.tokens[i].token}) must be strictly greater than ${ring.tokens[i - 1].token}`
      );
    }
  });

  test('removes server, removes its vnodes/tokens, and reallocates stored keys', () => {
    const ring = new ConsistentHashRing({ defaultVnodes: 40 });
    ring.addServer('node-a');
    ring.addServer('node-b');
    ring.addServer('node-c');

    // Add 150 data keys
    for (let i = 0; i < 150; i++) {
      ring.addData(i, { val: i });
    }

    const initialStats = ring.getDistributionStats();
    assert.strictEqual(initialStats.totalKeys, 150);

    const bKeysBefore = ring.getServerData('node-b');
    const bKeyCount = bKeysBefore.length;
    assert(bKeyCount > 0, 'node-b must hold some keys');

    // Remove node-b
    const result = ring.removeServer('node-b');
    assert.strictEqual(ring.hasServer('node-b'), false);
    assert.strictEqual(ring.getServers().length, 2);
    assert.strictEqual(ring.tokens.length, 80);
    assert.strictEqual(result.reallocatedKeys.length, bKeyCount);

    // All reallocated keys must now reside on node-a or node-c
    for (const reallocated of result.reallocatedKeys) {
      assert(['node-a', 'node-c'].includes(reallocated.newServerId!));
      const record = ring.getData(reallocated.key);
      assert(record !== null);
      assert.strictEqual(record.serverId, reallocated.newServerId);
    }

    // Keys not originally on node-b must remain completely untouched
    const aKeysAfter = ring.getServerData('node-a');
    const cKeysAfter = ring.getServerData('node-c');
    assert.strictEqual(aKeysAfter.length + cKeysAfter.length, 150);
  });

  test('adding a server redistributes relevant existing keys without data loss', () => {
    const ring = new ConsistentHashRing({ defaultVnodes: 50 });
    ring.addServer('alpha');
    ring.addServer('beta');

    for (let i = 1; i <= 200; i++) {
      ring.addData(i, { payload: `record-${i}` });
    }

    assert.strictEqual(ring.getAllData().length, 200);

    // Add 3rd server 'gamma'
    ring.addServer('gamma');
    assert.strictEqual(ring.getServers().length, 3);
    assert.strictEqual(ring.getAllData().length, 200);

    // Verify all 200 keys can still be fetched with valid payloads
    for (let i = 1; i <= 200; i++) {
      const item = ring.getData(i);
      assert(item !== null);
      assert(['alpha', 'beta', 'gamma'].includes(item.serverId));
      assert.strictEqual(item.data.payload, `record-${i}`);
    }

    const gammaKeys = ring.getServerData('gamma');
    assert(gammaKeys.length > 0, 'New server gamma must receive a portion of keys');
  });
});

// =====================================================================
// Suite 5: Numerical Data Keys
// =====================================================================
suite('Numerical Data Keys', () => {
  test('handles integer zero (0) without falsy evaluation bugs', () => {
    const ring = new ConsistentHashRing({ defaultVnodes: 20 });
    ring.addServer('node-zero');

    const res = ring.addData(0, { name: 'zero-record' });
    assert.strictEqual(res.serverId, 'node-zero');

    const retrieved = ring.getData(0);
    assert(retrieved !== null, 'Key 0 must be retrievable');
    assert.strictEqual(retrieved.key, 0);
    assert.strictEqual(retrieved.data.name, 'zero-record');

    const removed = ring.removeData(0);
    assert.strictEqual(removed, true);
    assert.strictEqual(ring.getData(0), null);
  });

  test('handles positive, negative, and large integers', () => {
    const ring = new ConsistentHashRing({ defaultVnodes: 30 });
    ring.addServer('node-1');
    ring.addServer('node-2');

    const keys = [
      -1,
      -9999,
      -2147483648,
      1,
      42,
      65536,
      2147483647,
      Number.MAX_SAFE_INTEGER, // 9,007,199,254,740,991
    ];

    for (const k of keys) {
      ring.addData(k, { original: k });
    }

    assert.strictEqual(ring.getAllData().length, keys.length);

    for (const k of keys) {
      const rec = ring.getData(k);
      assert(rec !== null, `Key ${k} must exist`);
      assert.strictEqual(rec.key, k);
      assert.strictEqual(rec.data.original, k);
      assert(['node-1', 'node-2'].includes(rec.serverId));
    }
  });

  test('handles floating point numerical keys', () => {
    const ring = new ConsistentHashRing({ defaultVnodes: 25 });
    ring.addServer('float-srv');

    const floats = [0.1, 0.0000001, 3.1415926535, 2.7182818284, 999.99999];
    for (const fl of floats) {
      ring.addData(fl, { val: fl });
    }

    for (const fl of floats) {
      const item = ring.getData(fl);
      assert(item !== null);
      assert.strictEqual(item.key, fl);
      assert.strictEqual(item.data.val, fl);
    }
  });
});

// =====================================================================
// Suite 6: Vnode Distribution Uniformity
// =====================================================================
suite('Vnode Distribution Uniformity', () => {
  test('5 servers with 100 vnodes distribute 5,000 keys uniformly within expected bounds', () => {
    const ring = new ConsistentHashRing({ defaultVnodes: 100, hashAlgorithm: 'md5' });
    const serverIds = ['server-alpha', 'server-beta', 'server-gamma', 'server-delta', 'server-epsilon'];

    for (const id of serverIds) {
      ring.addServer(id);
    }

    const totalKeys = 5000;
    for (let i = 0; i < totalKeys; i++) {
      ring.addData(i);
    }

    const stats = ring.getDistributionStats();
    assert.strictEqual(stats.totalServers, 5);
    assert.strictEqual(stats.totalVnodes, 500);
    assert.strictEqual(stats.totalKeys, 5000);

    const mean = totalKeys / 5; // 1,000 keys per server
    assert.strictEqual(mean, 1000);

    // Standard deviation and Coefficient of Variation (CV = stdDev / mean)
    const cv = stats.stdDev / mean;

    console.log(
      `    \x1b[90m↳ Mean: ${mean}, StdDev: ${stats.stdDev.toFixed(2)}, CV: ${(cv * 100).toFixed(1)}%, Load Ratio: ${stats.loadRatio.toFixed(2)}x\x1b[0m`
    );

    // Statistical bounds:
    // With 100 vnodes/server, standard deviation is expected to be well below 200 (CV < 20%)
    assert(
      stats.stdDev < 200,
      `Standard deviation (${stats.stdDev.toFixed(2)}) should be < 200 with 100 vnodes`
    );
    assert(
      cv < 0.20,
      `Coefficient of variation (${(cv * 100).toFixed(1)}%) should be < 20%`
    );

    // Peak-to-average load ratio should be bounded (typically 1.1x - 1.35x)
    assert(
      stats.loadRatio < 1.35,
      `Peak-to-average load ratio (${stats.loadRatio.toFixed(2)}x) must be < 1.35x`
    );

    // No server should be starved (each server must receive at least 14% of the keys vs 20% ideal)
    for (const s of stats.serverStats) {
      assert(
        s.loadPercentage >= 14.0,
        `Server ${s.serverId} load (${s.loadPercentage.toFixed(1)}%) must be >= 14%`
      );
      assert(
        s.loadPercentage <= 28.0,
        `Server ${s.serverId} load (${s.loadPercentage.toFixed(1)}%) must be <= 28%`
      );
    }

    // Sum of percentages must equal 100%
    const sumPct = stats.serverStats.reduce((sum, s) => sum + s.loadPercentage, 0);
    assert(Math.abs(sumPct - 100.0) < 0.01, 'Sum of load percentages must equal 100%');
  });

  test('increasing vnode count reduces standard deviation (5 vnodes vs 200 vnodes)', () => {
    // Ring with 5 vnodes (high variance expected)
    const ringLow = new ConsistentHashRing({ defaultVnodes: 5 });
    // Ring with 200 vnodes (smooth variance expected)
    const ringHigh = new ConsistentHashRing({ defaultVnodes: 200 });

    const servers = ['s1', 's2', 's3', 's4', 's5'];
    for (const s of servers) {
      ringLow.addServer(s);
      ringHigh.addServer(s);
    }

    for (let i = 0; i < 5000; i++) {
      ringLow.addData(i);
      ringHigh.addData(i);
    }

    const statsLow = ringLow.getDistributionStats();
    const statsHigh = ringHigh.getDistributionStats();

    console.log(
      `    \x1b[90m↳ 5 vnodes StdDev: ${statsLow.stdDev.toFixed(2)} (CV: ${(statsLow.stdDev / 10).toFixed(1)}%) | 200 vnodes StdDev: ${statsHigh.stdDev.toFixed(2)} (CV: ${(statsHigh.stdDev / 10).toFixed(1)}%)\x1b[0m`
    );

    // 5 vnodes has ~3x higher variance than 200 vnodes
    assert(
      statsHigh.stdDev < statsLow.stdDev,
      '200 vnodes must produce substantially lower standard deviation than 5 vnodes'
    );
  });
});

// =====================================================================
// Suite 7: Minimal Churn Property Verification
// =====================================================================
suite('Minimal Churn Property Verification', () => {
  test('adding (N+1)-th server migrates ~1/(N+1) keys leaving remaining keys unmoved', () => {
    // Ring with N=4 servers
    const ring = new ConsistentHashRing({ defaultVnodes: 100 });
    const initialServers = ['srv-0', 'srv-1', 'srv-2', 'srv-3'];
    for (const id of initialServers) {
      ring.addServer(id);
    }

    const totalKeys = 4000;
    for (let i = 0; i < totalKeys; i++) {
      ring.addData(i);
    }

    // Record baseline assignments for each key
    const initialAssignments = new Map<number, string>();
    for (let i = 0; i < totalKeys; i++) {
      const entry = ring.getData(i);
      assert(entry !== null);
      initialAssignments.set(i, entry.serverId);
    }

    // Theoretical migration for N=4 -> N+1=5:
    // Ideal migration fraction = 1 / (N + 1) = 1 / 5 = 20.0%
    const expectedMigrateFraction = 1 / 5; // 20%
    const expectedMigrateCount = totalKeys * expectedMigrateFraction; // 800 keys

    // Step A: Simulate addition
    const plan = ring.simulateAddition('srv-4', 100);
    assert.strictEqual(plan.targetServerId, 'srv-4');

    const simulatedFraction = plan.totalMoved / totalKeys;
    console.log(
      `    \x1b[90m↳ Theoretical: ${(expectedMigrateFraction * 100).toFixed(1)}% (${expectedMigrateCount} keys) | Simulated: ${(simulatedFraction * 100).toFixed(2)}% (${plan.totalMoved} keys)\x1b[0m`
    );

    // With 100 vnodes, simulated fraction should be within reasonable bounds: [15%, 25%]
    assert(
      simulatedFraction >= 0.15 && simulatedFraction <= 0.25,
      `Simulated migration (${(simulatedFraction * 100).toFixed(2)}%) must be near 20% [15%-25%]`
    );

    // Step B: Execute actual addition
    ring.addServer('srv-4', 100);

    // Step C: Verify invariant: keys NOT on srv-4 MUST NOT have moved between srv-0..srv-3
    let actualMovedToSrv4 = 0;
    let churnBetweenOldServers = 0;

    for (let i = 0; i < totalKeys; i++) {
      const oldServer = initialAssignments.get(i)!;
      const currentEntry = ring.getData(i);
      assert(currentEntry !== null);
      const newServer = currentEntry.serverId;

      if (newServer === 'srv-4') {
        actualMovedToSrv4++;
      } else {
        if (newServer !== oldServer) {
          churnBetweenOldServers++;
        }
      }
    }

    console.log(
      `    \x1b[90m↳ Actual Moved to srv-4: ${actualMovedToSrv4} | Churn Between Existing Servers: ${churnBetweenOldServers}\x1b[0m`
    );

    // The core consistent hashing invariant:
    // Zero keys move between the original servers!
    assert.strictEqual(
      churnBetweenOldServers,
      0,
      'Crucial Invariant: Zero keys should churn between existing servers when adding a new node'
    );

    // Actual moved keys must exactly equal simulated moved keys
    assert.strictEqual(
      actualMovedToSrv4,
      plan.totalMoved,
      'Actual keys transferred must strictly match simulated count'
    );

    // Contrast with modulo hashing:
    // With hash(key) % N, changing N from 4 to 5 churns ~80% of all keys!
    // Consistent hashing migrated ~20%, leaving ~80% pinned in cache.
  });
});

// =====================================================================
// Suite 8: Edge Cases & Error Handling
// =====================================================================
suite('Edge Cases & Error Handling', () => {
  test('empty ring safely returns null or empty collections without throwing', () => {
    const ring = new ConsistentHashRing();

    assert.strictEqual(ring.getNode('any-key'), null, 'getNode must return null on empty ring');
    assert.strictEqual(ring.getData(42), null, 'getData must return null on empty ring');
    assert.strictEqual(ring.removeData(42), false, 'removeData must return false on empty ring');
    assert.strictEqual(ring.getAllData().length, 0, 'getAllData must return [] on empty ring');
    assert.strictEqual(ring.getServers().length, 0);
    assert.strictEqual(ring.getVnodes().length, 0);

    const stats = ring.getDistributionStats();
    assert.strictEqual(stats.totalServers, 0);
    assert.strictEqual(stats.totalKeys, 0);
    assert.strictEqual(stats.stdDev, 0);
    assert.strictEqual(stats.loadRatio, 0);
  });

  test('addData on empty ring throws descriptive error', () => {
    const ring = new ConsistentHashRing();
    assert.throws(
      () => ring.addData(1, 'val'),
      /Cannot add data: ring has no active servers/
    );
  });

  test('duplicate server addition throws descriptive error', () => {
    const ring = new ConsistentHashRing();
    ring.addServer('srv-1');
    assert.throws(
      () => ring.addServer('srv-1'),
      /Server 'srv-1' already exists in ring/
    );
  });

  test('removing non-existent server throws descriptive error', () => {
    const ring = new ConsistentHashRing();
    ring.addServer('srv-1');
    assert.throws(
      () => ring.removeServer('phantom-node'),
      /Server 'phantom-node' does not exist in ring/
    );
  });

  test('invalid server ID strings throw descriptive errors', () => {
    const ring = new ConsistentHashRing();
    assert.throws(() => ring.addServer(''), /Server ID cannot be empty/);
    assert.throws(() => ring.addServer('   '), /Server ID cannot be empty/);
  });

  test('invalid server vnode count throws descriptive errors', () => {
    const ring = new ConsistentHashRing();
    assert.throws(() => ring.addServer('s1', 0), /vnodeCount must be a positive integer/);
    assert.throws(() => ring.addServer('s2', -10), /vnodeCount must be a positive integer/);
    assert.throws(() => ring.addServer('s3', 4.5), /vnodeCount must be a positive integer/);
  });

  test('simulateAddition on duplicate server throws descriptive error', () => {
    const ring = new ConsistentHashRing();
    ring.addServer('s1');
    assert.throws(() => ring.simulateAddition('s1'), /Server 's1' already exists in ring/);
    assert.throws(() => ring.simulateAddition(''), /Server ID cannot be empty/);
  });

  test('simulateAddition on empty ring returns zero moved keys plan', () => {
    const ring = new ConsistentHashRing();
    const plan = ring.simulateAddition('s1');
    assert.strictEqual(plan.targetServerId, 's1');
    assert.strictEqual(plan.totalMoved, 0);
    assert.strictEqual(plan.percentageMoved, 0);
  });

  test('getServerData on non-existent server throws descriptive error', () => {
    const ring = new ConsistentHashRing();
    assert.throws(() => ring.getServerData('non-existent'), /Server 'non-existent' does not exist in ring/);
  });

  test('complete server decommission leaves ring cleanly empty', () => {
    const ring = new ConsistentHashRing({ defaultVnodes: 10 });
    ring.addServer('s1');
    ring.addServer('s2');

    ring.addData(1, 'one');
    ring.addData(2, 'two');

    ring.removeServer('s1');
    assert.strictEqual(ring.getServers().length, 1);
    assert.strictEqual(ring.getAllData().length, 2);

    // Evict final server
    const finalResult = ring.removeServer('s2');
    assert.strictEqual(ring.getServers().length, 0);
    assert.strictEqual(ring.tokens.length, 0);
    assert.strictEqual(ring.getAllData().length, 0);

    for (const item of finalResult.reallocatedKeys) {
      assert.strictEqual(item.newServerId, null);
    }
  });
});

// =====================================================================
// Final Summary & Verification Report
// =====================================================================
console.log(`\n\x1b[1m\x1b[37m=================================================================\x1b[0m`);
console.log(`\x1b[1m\x1b[32m✔ VERIFICATION COMPLETE:\x1b[0m \x1b[1m${ctx.passed} tests passed\x1b[0m, ${ctx.failed} failed \x1b[90m(${ctx.totalDurationMs.toFixed(2)}ms total)\x1b[0m`);
console.log(`\x1b[1m\x1b[37m=================================================================\x1b[0m\n`);

if (ctx.failed > 0) {
  process.exit(1);
}
