import readline from 'node:readline';
import { ConsistentHashRing } from '../core/ring.js';
import {
  c,
  formatBanner,
  formatMigration,
  formatStats,
  formatTable,
  getServerColor,
  renderRing,
} from './view.js';
import { runDemo } from './demo.js';

const COMMANDS = [
  'add-server',
  'remove-server',
  'servers',
  'add-data',
  'add-range',
  'lookup',
  'get',
  'list-data',
  'stats',
  'distribution',
  'ring',
  'simulate-add',
  'demo',
  'help',
  'clear',
  'exit',
  'quit',
];

function completer(line: string): [string[], string] {
  const trimmed = line.trim();
  const hits = COMMANDS.filter((cmd) => cmd.startsWith(trimmed));
  return [hits.length ? hits : COMMANDS, trimmed];
}

/**
 * Prints formatted help documentation.
 */
function printHelp(): void {
  const headers = ['COMMAND', 'ARGUMENTS', 'DESCRIPTION'];
  const alignments: ('left' | 'left' | 'left')[] = ['left', 'left', 'left'];

  const rows = [
    [`${c.brightCyan}add-server${c.reset}`, '<id> [vnodes]', 'Add a physical server with virtual node replicas'],
    [`${c.brightCyan}remove-server${c.reset}`, '<id>', 'Remove physical server and migrate its keys clockwise'],
    [`${c.brightCyan}servers${c.reset}`, '', 'List physical servers, vnode counts, and allocations'],
    [`${c.brightCyan}add-data${c.reset}`, '<number> [payload]', 'Store data payload by numeric key on the ring'],
    [`${c.brightCyan}add-range${c.reset}`, '<start> <end>', 'Batch-insert range of numeric keys [start..end]'],
    [`${c.brightCyan}lookup / get${c.reset}`, '<number>', 'Locate target server and vnode via clockwise binary search'],
    [`${c.brightCyan}list-data${c.reset}`, '[serverId]', 'Display stored keys, optionally filtered by server'],
    [`${c.brightCyan}stats / distribution${c.reset}`, '', 'Show cluster distribution metrics and load bar charts'],
    [`${c.brightCyan}ring${c.reset}`, '', 'Visualize 32-bit token ring diagram and density arc'],
    [`${c.brightCyan}simulate-add${c.reset}`, '<id> [vnodes]', 'Simulate adding candidate server and show migration plan'],
    [`${c.brightCyan}demo${c.reset}`, '', 'Run automated step-by-step migration demonstration'],
    [`${c.brightCyan}clear${c.reset}`, '', 'Clear terminal screen'],
    [`${c.brightCyan}help${c.reset}`, '', 'Display this reference table'],
    [`${c.brightCyan}exit / quit${c.reset}`, '', 'Terminate interactive REPL session'],
  ];

  console.log(`\n${c.bold}${c.white}COMMAND REFERENCE${c.reset}`);
  console.log(`${c.dim}────────────────────────────────────────────────────────────────────────${c.reset}`);
  console.log(formatTable(headers, rows, alignments));
  console.log(`${c.dim}Tip: Press <Tab> to autocomplete commands.${c.reset}\n`);
}

/**
 * Interactive REPL for managing and inspecting the Consistent Hash Ring.
 */
export async function startRepl(initialRing?: ConsistentHashRing): Promise<void> {
  const ring = initialRing ?? new ConsistentHashRing({ defaultVnodes: 50 });

  console.log(formatBanner());
  console.log(`\n  ${c.dim}Type ${c.brightCyan}help${c.dim} for available commands or ${c.brightCyan}exit${c.dim} to quit.${c.reset}`);
  console.log(`  ${c.dim}Default virtual node count: ${c.white}50 vnodes/server${c.reset}\n`);

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: `${c.brightCyan}hash-ring${c.reset} ${c.dim}›${c.reset} `,
    completer,
  });

  rl.prompt();

  for await (const rawLine of rl) {
    const line = rawLine.trim();

    if (!line) {
      rl.prompt();
      continue;
    }

    const [cmd, ...args] = line.split(/\s+/);
    const command = cmd.toLowerCase();

    try {
      switch (command) {
        case 'help':
        case '?': {
          printHelp();
          break;
        }

        case 'clear':
        case 'cls': {
          console.clear();
          console.log(formatBanner());
          break;
        }

        case 'exit':
        case 'quit':
        case 'q': {
          console.log(`  ${c.dim}Closing hash-ring session.${c.reset}`);
          rl.close();
          return;
        }

        case 'add-server':
        case 'add-node': {
          const id = args[0];
          if (!id) {
            console.log(`  ${c.crimson}Error: Server ID is required. Usage: add-server <id> [vnodes]${c.reset}`);
            break;
          }
          const vnodes = args[1] !== undefined ? parseInt(args[1], 10) : undefined;
          if (vnodes !== undefined && (isNaN(vnodes) || vnodes <= 0)) {
            console.log(`  ${c.crimson}Error: [vnodes] must be a positive integer.${c.reset}`);
            break;
          }

          ring.addServer(id, vnodes);
          const sColor = getServerColor(id);
          const assignedVnodes = vnodes ?? 50;
          console.log(
            `  ${c.emerald}•${c.reset} Added server ${sColor}${id}${c.reset} with ${assignedVnodes} vnodes.` +
              ` ${c.dim}(Cluster now has ${ring.getServers().length} servers, ${ring.tokens.length} vnodes)${c.reset}`
          );
          break;
        }

        case 'remove-server':
        case 'rm-server':
        case 'del-server': {
          const id = args[0];
          if (!id) {
            console.log(`  ${c.crimson}Error: Server ID is required. Usage: remove-server <id>${c.reset}`);
            break;
          }

          const sColor = getServerColor(id);
          const result = ring.removeServer(id);
          console.log(
            `  ${c.emerald}•${c.reset} Removed server ${sColor}${id}${c.reset}.` +
              ` Reallocated ${c.bold}${result.reallocatedKeys.length}${c.reset} keys to remaining nodes.`
          );
          break;
        }

        case 'servers':
        case 'nodes':
        case 'ls-servers': {
          const servers = ring.getServers();
          if (servers.length === 0) {
            console.log(`  ${c.dim}(No active servers in ring)${c.reset}`);
            break;
          }

          const stats = ring.getDistributionStats();
          const headers = ['SERVER ID', 'VNODES', 'KEYS ALLOCATED', 'LOAD SHARE'];
          const alignments: ('left' | 'right' | 'right' | 'right')[] = ['left', 'right', 'right', 'right'];

          const rows = stats.serverStats.map((s, idx) => {
            const sColor = getServerColor(s.serverId, idx);
            return [
              `${sColor}${s.serverId}${c.reset}`,
              s.vnodeCount,
              s.keyCount,
              `${s.loadPercentage.toFixed(1)}%`,
            ];
          });

          console.log(`\n${c.bold}${c.white}REGISTERED SERVERS${c.reset}`);
          console.log(`${c.dim}────────────────────────────────────────────────────────────────────────${c.reset}`);
          console.log(formatTable(headers, rows, alignments));
          console.log(`  ${c.dim}Total: ${servers.length} servers · ${ring.tokens.length} vnodes · ${ring.keys.size} keys${c.reset}\n`);
          break;
        }

        case 'add-data':
        case 'put':
        case 'set': {
          const rawKey = args[0];
          if (rawKey === undefined) {
            console.log(`  ${c.crimson}Error: Numeric key is required. Usage: add-data <number> [payload]${c.reset}`);
            break;
          }
          const numKey = parseInt(rawKey, 10);
          if (isNaN(numKey)) {
            console.log(`  ${c.crimson}Error: Key must be a valid integer.${c.reset}`);
            break;
          }

          const payload = args.length > 1 ? args.slice(1).join(' ') : undefined;
          const placement = ring.addData(numKey, payload);
          const sColor = getServerColor(placement.serverId);

          console.log(
            `  ${c.emerald}•${c.reset} Key ${c.bold}${numKey}${c.reset} stored on ${sColor}${placement.serverId}${c.reset} ` +
              `${c.dim}(vnode: ${placement.vnodeId}, token: 0x${placement.token.toString(16).padStart(8, '0').toUpperCase()})${c.reset}`
          );
          break;
        }

        case 'add-range':
        case 'batch-add': {
          const startStr = args[0];
          const endStr = args[1];
          if (startStr === undefined || endStr === undefined) {
            console.log(`  ${c.crimson}Error: Start and end range required. Usage: add-range <start> <end>${c.reset}`);
            break;
          }

          const start = parseInt(startStr, 10);
          const end = parseInt(endStr, 10);
          if (isNaN(start) || isNaN(end)) {
            console.log(`  ${c.crimson}Error: Range bounds must be integers.${c.reset}`);
            break;
          }
          if (start > end) {
            console.log(`  ${c.crimson}Error: Start must be less than or equal to end.${c.reset}`);
            break;
          }

          const count = end - start + 1;
          if (count > 100_000) {
            console.log(`  ${c.crimson}Error: Batch range cannot exceed 100,000 keys.${c.reset}`);
            break;
          }

          const t0 = performance.now();
          for (let k = start; k <= end; k++) {
            ring.addData(k);
          }
          const elapsed = (performance.now() - t0).toFixed(1);

          console.log(
            `  ${c.emerald}•${c.reset} Injected ${c.bold}${count}${c.reset} keys [${start}..${end}] in ${elapsed}ms.` +
              ` ${c.dim}(Ring key count: ${ring.keys.size})${c.reset}`
          );
          break;
        }

        case 'lookup':
        case 'get':
        case 'find': {
          const rawKey = args[0];
          if (rawKey === undefined) {
            console.log(`  ${c.crimson}Error: Key required. Usage: lookup <number>${c.reset}`);
            break;
          }

          const numKey = parseInt(rawKey, 10);
          if (isNaN(numKey)) {
            console.log(`  ${c.crimson}Error: Key must be a valid integer.${c.reset}`);
            break;
          }

          const match = ring.getNode(numKey);
          if (!match) {
            console.log(`  ${c.crimson}Error: Cannot lookup key — ring has no active servers.${c.reset}`);
            break;
          }

          const stored = ring.getData(numKey);
          const sColor = getServerColor(match.server.id);
          const hexToken = `0x${match.keyToken.toString(16).padStart(8, '0').toUpperCase()}`;
          const vnodeHex = `0x${match.vnode.token.toString(16).padStart(8, '0').toUpperCase()}`;

          console.log(`\n${c.bold}${c.white}KEY ROUTING RESOLUTION${c.reset}`);
          console.log(`${c.dim}────────────────────────────────────────────────────────────────────────${c.reset}`);
          console.log(`  ${c.dim}Numeric Key       :${c.reset} ${c.bold}${numKey}${c.reset}`);
          console.log(`  ${c.dim}Key Hash Token    :${c.reset} ${c.cyan}${hexToken}${c.reset} ${c.dim}(${match.keyToken})${c.reset}`);
          console.log(`  ${c.dim}Clockwise Vnode   :${c.reset} ${sColor}${match.vnode.vnodeId}${c.reset} ${c.dim}(token ${vnodeHex})${c.reset}`);
          console.log(`  ${c.dim}Physical Server   :${c.reset} ${sColor}${match.server.id}${c.reset}`);
          console.log(`  ${c.dim}Stored Payload    :${c.reset} ${
            stored ? `${c.white}${JSON.stringify(stored.data ?? 'null')}${c.reset}` : `${c.dim}(not stored in ring map)${c.reset}`
          }\n`);
          break;
        }

        case 'list-data':
        case 'keys':
        case 'data': {
          const serverId = args[0];
          if (serverId) {
            if (!ring.hasServer(serverId)) {
              console.log(`  ${c.crimson}Error: Server '${serverId}' not found.${c.reset}`);
              break;
            }
            const keys = ring.getServerData(serverId);
            const sColor = getServerColor(serverId);
            console.log(`\n  ${c.bold}Keys assigned to ${sColor}${serverId}${c.reset} (${keys.length} total):`);
            if (keys.length === 0) {
              console.log(`  ${c.dim}(No keys assigned to this server)${c.reset}\n`);
            } else {
              const display = keys.slice(0, 30);
              console.log(`  ${display.join(', ')}${keys.length > 30 ? ` ${c.dim}... +${keys.length - 30} more${c.reset}` : ''}\n`);
            }
          } else {
            const allData = ring.getAllData();
            console.log(`\n  ${c.bold}Stored Keys Summary${c.reset} (${allData.length} total across all servers):`);
            if (allData.length === 0) {
              console.log(`  ${c.dim}(Ring is currently empty)${c.reset}\n`);
            } else {
              const stats = ring.getDistributionStats();
              for (const s of stats.serverStats) {
                const sColor = getServerColor(s.serverId);
                console.log(`  ${sColor}${s.serverId}${c.reset}: ${s.keyCount} keys (${s.loadPercentage.toFixed(1)}%)`);
              }
              console.log('');
            }
          }
          break;
        }

        case 'stats':
        case 'distribution':
        case 'status': {
          console.log(`\n${formatStats(ring.getDistributionStats())}\n`);
          break;
        }

        case 'ring':
        case 'topo':
        case 'topology': {
          console.log(`\n${renderRing(ring)}\n`);
          break;
        }

        case 'simulate-add':
        case 'sim-add': {
          const id = args[0];
          if (!id) {
            console.log(`  ${c.crimson}Error: Server ID required. Usage: simulate-add <id> [vnodes]${c.reset}`);
            break;
          }
          const vnodes = args[1] !== undefined ? parseInt(args[1], 10) : undefined;
          if (vnodes !== undefined && (isNaN(vnodes) || vnodes <= 0)) {
            console.log(`  ${c.crimson}Error: [vnodes] must be a positive integer.${c.reset}`);
            break;
          }

          const plan = ring.simulateAddition(id, vnodes);
          console.log(`\n${formatMigration(plan)}\n`);
          break;
        }

        case 'demo': {
          console.log(`\n  ${c.cyan}Starting automated demonstration...${c.reset}\n`);
          await runDemo();
          break;
        }

        default: {
          console.log(
            `  ${c.crimson}Unknown command '${cmd}'. Type ${c.brightCyan}help${c.crimson} for available commands.${c.reset}`
          );
          break;
        }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`  ${c.crimson}Error: ${msg}${c.reset}`);
    }

    rl.prompt();
  }
}
