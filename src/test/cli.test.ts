import assert from 'node:assert';
import { ConsistentHashRing } from '../core/ring.js';
import {
  buildBar,
  c,
  formatBanner,
  formatMigration,
  formatStats,
  formatTable,
  padString,
  renderRing,
  stripAnsi,
} from '../cli/view.js';
import { runDemo } from '../cli/demo.js';

async function main(): Promise<void> {
  console.log(`${c.bold}${c.white}Running CLI Presentation & REPL Unit Tests...${c.reset}`);

  // 1. stripAnsi & padString
  assert.strictEqual(stripAnsi('\x1b[36mtest\x1b[0m'), 'test');
  assert.strictEqual(padString('abc', 6, 'left'), 'abc   ');
  assert.strictEqual(padString('abc', 6, 'right'), '   abc');
  assert.strictEqual(padString('abc', 6, 'center'), ' abc  ');

  // 2. buildBar
  const bar50 = stripAnsi(buildBar(50, 10));
  assert.strictEqual(bar50, '[■■■■■·····]');
  const bar0 = stripAnsi(buildBar(0, 10));
  assert.strictEqual(bar0, '[··········]');
  const bar100 = stripAnsi(buildBar(100, 10));
  assert.strictEqual(bar100, '[■■■■■■■■■■]');

  // 3. formatBanner
  const banner = stripAnsi(formatBanner());
  assert(banner.includes('CONSISTENT HASH RING'));
  assert(banner.includes('32-bit token ring space'));

  // 4. formatTable
  const table = formatTable(
    ['SERVER', 'KEYS', 'SHARE'],
    [
      ['alpha', 100, '50.0%'],
      ['beta', 100, '50.0%'],
    ],
    ['left', 'right', 'right']
  );
  assert(stripAnsi(table).includes('SERVER'));
  assert(stripAnsi(table).includes('alpha'));
  assert(stripAnsi(table).includes('beta'));

  // 5. formatStats
  const ring = new ConsistentHashRing({ defaultVnodes: 25 });
  ring.addServer('srv-1', 25);
  ring.addServer('srv-2', 25);
  for (let i = 1; i <= 100; i++) {
    ring.addData(i);
  }
  const stats = ring.getDistributionStats();
  const statsOutput = stripAnsi(formatStats(stats));
  assert(statsOutput.includes('DISTRIBUTION METRICS'));
  assert(statsOutput.includes('Physical Servers : 2'));
  assert(statsOutput.includes('Stored Keys      : 100'));
  assert(statsOutput.includes('srv-1'));
  assert(statsOutput.includes('srv-2'));

  // Empty ring stats
  const emptyStats = stripAnsi(formatStats(new ConsistentHashRing().getDistributionStats()));
  assert(emptyStats.includes('(No active servers in ring)'));

  // 6. renderRing
  const ringOutput = stripAnsi(renderRing(ring));
  assert(ringOutput.includes('RING TOPOLOGY MAP'));
  assert(ringOutput.includes('Linear Partition Sector Density'));
  assert(ringOutput.includes('0x00000000'));
  assert(ringOutput.includes('0x80000000'));

  // Empty ring topology
  const emptyRingOutput = stripAnsi(renderRing(new ConsistentHashRing()));
  assert(emptyRingOutput.includes('Ring is empty'));

  // 7. formatMigration
  const plan = ring.simulateAddition('srv-3', 25);
  const migOutput = stripAnsi(formatMigration(plan));
  assert(migOutput.includes('MIGRATION ANALYSIS'));
  assert(migOutput.includes('Target Node:'));
  assert(migOutput.includes('srv-3'));

  // 8. runDemo with 0ms delay
  console.log('Testing automated runDemo() execution...');
  await runDemo({ delayMs: 0 });

  console.log(`${c.emerald}✔ All CLI tests passed successfully!${c.reset}\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
