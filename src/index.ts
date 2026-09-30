#!/usr/bin/env node

import { runDemo } from './cli/demo.js';
import { startRepl } from './cli/repl.js';
import { c, formatBanner } from './cli/view.js';

// Export full public API for programmatic use
export * from './core/index.js';
export * from './cli/view.js';
export * from './cli/demo.js';
export * from './cli/repl.js';

function printCliHelp(): void {
  console.log('\n' + formatBanner() + '\n');
  console.log(`${c.bold}${c.white}USAGE${c.reset}`);
  console.log(`  ${c.dim}$${c.reset} ${c.brightCyan}consistent-hash-ring${c.reset} ${c.silver}[options]${c.reset}\n`);
  console.log(`${c.bold}${c.white}OPTIONS${c.reset}`);
  console.log(`  ${c.brightCyan}-d, --demo${c.reset}       Run automated step-by-step visual demonstration`);
  console.log(`  ${c.brightCyan}-h, --help${c.reset}       Display this help message`);
  console.log(`  ${c.brightCyan}-v, --version${c.reset}    Show version number (1.0.0)\n`);
  console.log(`${c.bold}${c.white}MODES${c.reset}`);
  console.log(`  ${c.dim}• Default (no flags) : Launches interactive terminal REPL (hash-ring › )${c.reset}`);
  console.log(`  ${c.dim}• Demo mode          : Demonstrates minimal churn, virtual node spread, and load metrics${c.reset}\n`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    printCliHelp();
    process.exit(0);
  }

  if (args.includes('--version') || args.includes('-v')) {
    console.log('consistent-hash-ring v1.0.0');
    process.exit(0);
  }

  if (args.includes('--demo') || args.includes('-d')) {
    await runDemo();
    process.exit(0);
  }

  // Default: start interactive REPL
  await startRepl();
}

// Detect direct CLI invocation
const isMain =
  Boolean(process.argv[1]) &&
  (process.argv[1].endsWith('index.ts') ||
    process.argv[1].endsWith('index.js') ||
    process.argv[1].endsWith('consistent-hash-ring'));

if (isMain) {
  main().catch((err) => {
    console.error(`\x1b[31mFatal error: ${err instanceof Error ? err.message : String(err)}\x1b[0m`);
    process.exit(1);
  });
}
