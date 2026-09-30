import type { ConsistentHashRing } from '../core/ring.js';
import type { DistributionStats, MigrationPlan, RingToken } from '../core/types.js';

/**
 * Terminal ANSI styling codes adhering to modern minimalist developer aesthetics.
 */
export const c = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m\x1b[90m',
  italic: '\x1b[3m',
  underline: '\x1b[4m',

  // Grayscale & dark-mode accents
  white: '\x1b[97m',
  gray: '\x1b[90m',
  silver: '\x1b[37m',

  // Semantic developer palette
  cyan: '\x1b[36m',
  brightCyan: '\x1b[96m',
  emerald: '\x1b[32m',
  brightEmerald: '\x1b[92m',
  amber: '\x1b[33m',
  brightAmber: '\x1b[93m',
  violet: '\x1b[35m',
  brightViolet: '\x1b[95m',
  crimson: '\x1b[31m',
  blue: '\x1b[34m',
  brightBlue: '\x1b[94m',
};

/** Palette for dynamically assigning distinct server colors */
const SERVER_COLORS = [
  c.brightCyan,
  c.brightEmerald,
  c.brightAmber,
  c.brightViolet,
  c.brightBlue,
  c.silver,
];

/**
 * Returns a stable ANSI color for a given server ID.
 */
export function getServerColor(serverId: string, index?: number): string {
  if (typeof index === 'number' && index >= 0) {
    return SERVER_COLORS[index % SERVER_COLORS.length];
  }
  let hash = 0;
  for (let i = 0; i < serverId.length; i++) {
    hash = (hash * 31 + serverId.charCodeAt(i)) >>> 0;
  }
  return SERVER_COLORS[hash % SERVER_COLORS.length];
}

/**
 * Strips ANSI escape sequences to compute visual character length.
 */
export function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');
}

/**
 * Pads a string taking ANSI escape sequences into account.
 */
export function padString(
  text: string,
  width: number,
  align: 'left' | 'right' | 'center' = 'left',
  padChar: string = ' '
): string {
  const visibleLength = stripAnsi(text).length;
  if (visibleLength >= width) return text;
  const paddingNeeded = width - visibleLength;

  if (align === 'right') {
    return padChar.repeat(paddingNeeded) + text;
  }
  if (align === 'center') {
    const leftPad = Math.floor(paddingNeeded / 2);
    const rightPad = paddingNeeded - leftPad;
    return padChar.repeat(leftPad) + text + padChar.repeat(rightPad);
  }
  return text + padChar.repeat(paddingNeeded);
}

/**
 * Generates an executive-grade minimalist ASCII banner.
 */
export function formatBanner(): string {
  const lines = [
    `${c.dim}┌────────────────────────────────────────────────────────────────────────┐${c.reset}`,
    `${c.dim}│${c.reset}  ${c.bold}${c.white}CONSISTENT HASH RING${c.reset}                                           ${c.dim}v1.0.0 │${c.reset}`,
    `${c.dim}│${c.reset}  ${c.dim}32-bit token ring space [0 .. 4,294,967,295]                         │${c.reset}`,
    `${c.dim}│${c.reset}  ${c.dim}Virtual node replication · Clockwise binary search · Minimal churn   │${c.reset}`,
    `${c.dim}└────────────────────────────────────────────────────────────────────────┘${c.reset}`,
  ];
  return lines.join('\n');
}

/**
 * Formats data into a precision-aligned monospace table.
 */
export function formatTable(
  headers: string[],
  rows: (string | number)[][],
  alignments?: ('left' | 'right' | 'center')[]
): string {
  const colCount = headers.length;
  const colWidths: number[] = headers.map((h) => stripAnsi(String(h)).length);
  const aligns: ('left' | 'right' | 'center')[] = alignments ?? headers.map(() => 'left');

  for (const row of rows) {
    for (let i = 0; i < colCount; i++) {
      const cellText = row[i] !== undefined ? String(row[i]) : '';
      const len = stripAnsi(cellText).length;
      if (len > colWidths[i]) {
        colWidths[i] = len;
      }
    }
  }

  // Add 1 char padding on each side
  const paddedWidths = colWidths.map((w) => w + 2);

  const topBorder =
    `${c.dim}┌` + paddedWidths.map((w) => '─'.repeat(w)).join('┬') + `┐${c.reset}`;
  const headerSeparator =
    `${c.dim}├` + paddedWidths.map((w) => '─'.repeat(w)).join('┼') + `┤${c.reset}`;
  const bottomBorder =
    `${c.dim}└` + paddedWidths.map((w) => '─'.repeat(w)).join('┴') + `┘${c.reset}`;

  const headerRow =
    `${c.dim}│${c.reset}` +
    headers
      .map((h, i) => {
        const text = padString(` ${h} `, paddedWidths[i], aligns[i]);
        return `${c.bold}${c.white}${text}${c.reset}`;
      })
      .join(`${c.dim}│${c.reset}`) +
    `${c.dim}│${c.reset}`;

  const dataRows = rows.map((row) => {
    return (
      `${c.dim}│${c.reset}` +
      row
        .map((cell, i) => {
          const cellStr = cell !== undefined ? String(cell) : '';
          return padString(` ${cellStr} `, paddedWidths[i], aligns[i]);
        })
        .join(`${c.dim}│${c.reset}`) +
      `${c.dim}│${c.reset}`
    );
  });

  return [topBorder, headerRow, headerSeparator, ...dataRows, bottomBorder].join('\n');
}

/**
 * Builds a monospace load distribution bar chart: [■■■■■····]
 */
export function buildBar(percentage: number, width: number = 20, color: string = c.brightCyan): string {
  const clamped = Math.max(0, Math.min(100, percentage));
  const filled = Math.round((clamped / 100) * width);
  const empty = width - filled;
  return `${c.dim}[${c.reset}${color}${'■'.repeat(filled)}${c.dim}${'·'.repeat(empty)}]${c.reset}`;
}

/**
 * Formats distribution metrics and per-server load bar charts.
 */
export function formatStats(stats: DistributionStats): string {
  const { totalServers, totalVnodes, totalKeys, serverStats, stdDev, loadRatio } = stats;

  const summaryLines: string[] = [
    `${c.bold}${c.white}DISTRIBUTION METRICS${c.reset}`,
    `${c.dim}────────────────────────────────────────────────────────────────────────${c.reset}`,
    `  ${c.dim}Physical Servers :${c.reset} ${c.bold}${totalServers}${c.reset}`,
    `  ${c.dim}Virtual Nodes    :${c.reset} ${c.bold}${totalVnodes}${c.reset} ${
      totalServers > 0 ? `${c.dim}(avg ${(totalVnodes / totalServers).toFixed(1)} vnodes/node)${c.reset}` : ''
    }`,
    `  ${c.dim}Stored Keys      :${c.reset} ${c.bold}${totalKeys}${c.reset}`,
    `  ${c.dim}Std Deviation    :${c.reset} ${c.bold}${stdDev.toFixed(2)}${c.reset} keys ${
      totalKeys > 0 ? `${c.dim}(CV: ${((stdDev / (totalKeys / Math.max(1, totalServers))) * 100).toFixed(1)}%)${c.reset}` : ''
    }`,
    `  ${c.dim}Load Ratio       :${c.reset} ${c.bold}${loadRatio.toFixed(2)}x${c.reset} ${c.dim}(peak load / mean load)${c.reset}`,
    '',
  ];

  if (serverStats.length === 0) {
    summaryLines.push(`  ${c.dim}(No active servers in ring)${c.reset}`);
    return summaryLines.join('\n');
  }

  const headers = ['SERVER', 'VNODES', 'KEYS', 'SHARE', 'LOAD DISTRIBUTION'];
  const alignments: ('left' | 'right' | 'center')[] = ['left', 'right', 'right', 'right', 'left'];

  const rows = serverStats.map((s, idx) => {
    const sColor = getServerColor(s.serverId, idx);
    const serverLabel = `${sColor}${s.serverId}${c.reset}`;
    const vnodes = String(s.vnodeCount);
    const keys = String(s.keyCount);
    const share = `${s.loadPercentage.toFixed(1)}%`;
    const bar = `${buildBar(s.loadPercentage, 18, sColor)} ${s.loadPercentage.toFixed(1)}%`;

    return [serverLabel, vnodes, keys, share, bar];
  });

  summaryLines.push(formatTable(headers, rows, alignments));
  return summaryLines.join('\n');
}

/**
 * Finds the clockwise successor token in a sorted token list.
 */
function findClockwiseOwner(tokens: RingToken[], targetToken: number): RingToken | null {
  if (tokens.length === 0) return null;
  if (targetToken > tokens[tokens.length - 1].token) {
    return tokens[0];
  }
  let low = 0;
  let high = tokens.length - 1;
  let ans = high;
  while (low <= high) {
    const mid = (low + high) >>> 1;
    if (tokens[mid].token >= targetToken) {
      ans = mid;
      high = mid - 1;
    } else {
      low = mid + 1;
    }
  }
  return tokens[ans];
}

/**
 * Visualizes the 32-bit token ring topology with an ASCII clock diagram
 * and linear continuous sector partition density map.
 */
export function renderRing(ring: ConsistentHashRing): string {
  const servers = ring.getServers();
  const tokens = ring.tokens;
  const keyCount = ring.keys.size;

  if (servers.length === 0 || tokens.length === 0) {
    return [
      `${c.bold}${c.white}RING TOPOLOGY VISUALIZER${c.reset}`,
      `${c.dim}────────────────────────────────────────────────────────────────────────${c.reset}`,
      `  ${c.dim}[Ring is empty — 0 servers registered]${c.reset}`,
    ].join('\n');
  }

  // 1. Build 8-point radial sector inspection points
  const sectors = [
    { label: '0x00000000', angle: '  0°', token: 0 },
    { label: '0x20000000', angle: ' 45°', token: 0x20000000 },
    { label: '0x40000000', angle: ' 90°', token: 0x40000000 },
    { label: '0x60000000', angle: '135°', token: 0x60000000 },
    { label: '0x80000000', angle: '180°', token: 0x80000000 },
    { label: '0xA0000000', angle: '225°', token: 0xa0000000 },
    { label: '0xC0000000', angle: '270°', token: 0xc0000000 },
    { label: '0xE0000000', angle: '315°', token: 0xe0000000 },
  ];

  const sectorOwners = sectors.map((s) => {
    const owner = findClockwiseOwner(tokens, s.token);
    return {
      ...s,
      ownerServer: owner ? owner.serverId : 'none',
      vnodeId: owner ? owner.vnodeId : 'none',
    };
  });

  const getOwnerBadge = (secIndex: number, width: number = 18): string => {
    const item = sectorOwners[secIndex];
    const color = getServerColor(item.ownerServer);
    const text = `${item.ownerServer} (${item.vnodeId.split('#')[1] ?? '0'})`;
    return padString(`${color}${text}${c.reset}`, width, 'center');
  };

  const lines: string[] = [
    `${c.bold}${c.white}RING TOPOLOGY MAP${c.reset} ${c.dim}[32-bit uint32 token space: 0 .. 2³²-1]${c.reset}`,
    `${c.dim}────────────────────────────────────────────────────────────────────────${c.reset}`,
    '',
    `                           ${c.dim}0x00000000 [  0°]${c.reset}`,
    `                          ${getOwnerBadge(0)}`,
    `                             ${c.dim}┌───┬───┐${c.reset}`,
    `                       ${c.dim}┌─────┘   │   └─────┐${c.reset}`,
    `         ${c.dim}0xE0000000 [315°]${c.reset}  ${c.dim}│         │         │${c.reset}  ${c.dim}0x20000000 [ 45°]${c.reset}`,
    `        ${getOwnerBadge(7, 16)}   ${c.dim}│         │         │${c.reset}   ${getOwnerBadge(1, 16)}`,
    `                       ${c.dim}┌─────┘   │   └─────┐${c.reset}`,
    `  ${c.dim}0xC0000000 [270°]${c.reset}   ${c.dim}│    ${c.bold}${c.white}CONSISTENT RING${c.reset}${c.dim}    │${c.reset}   ${c.dim}0x40000000 [ 90°]${c.reset}`,
    ` ${getOwnerBadge(6, 17)}  ${c.dim}├──  ${c.brightCyan}${String(servers.length).padStart(2)} servers${c.reset}${c.dim}    ──┤${c.reset}  ${getOwnerBadge(2, 17)}`,
    `                       ${c.dim}│    ${c.silver}${String(tokens.length).padStart(3)} vnodes${c.reset}${c.dim}     │${c.reset}`,
    `                       ${c.dim}│    ${c.gray}${String(keyCount).padStart(3)} keys${c.reset}${c.dim}       │${c.reset}`,
    `                       ${c.dim}└─────┐   │   ┌─────┘${c.reset}`,
    `        ${getOwnerBadge(5, 16)}   ${c.dim}│         │         │${c.reset}   ${getOwnerBadge(3, 16)}`,
    `         ${c.dim}0xA0000000 [225°]${c.reset}  ${c.dim}│         │         │${c.reset}  ${c.dim}0x60000000 [135°]${c.reset}`,
    `                       ${c.dim}└─────┐   │   ┌─────┘${c.reset}`,
    `                             ${c.dim}└───┴───┘${c.reset}`,
    `                          ${getOwnerBadge(4)}`,
    `                           ${c.dim}0x80000000 [180°]${c.reset}`,
    '',
    `${c.dim}── Linear Partition Sector Density ──────────────────────────────────────${c.reset}`,
  ];

  // 2. Linear continuous density strip: 50 sample segments across [0 .. 2^32 - 1]
  const sampleCount = 50;
  let barStr = '';
  const serverSlices = new Map<string, number>();

  for (let i = 0; i < sampleCount; i++) {
    const sampleToken = Math.floor((i / sampleCount) * 0xffffffff);
    const owner = findClockwiseOwner(tokens, sampleToken);
    const sid = owner ? owner.serverId : 'none';
    const sColor = getServerColor(sid);
    barStr += `${sColor}■${c.reset}`;
    serverSlices.set(sid, (serverSlices.get(sid) ?? 0) + 1);
  }

  lines.push(`  ${c.dim}[0x00000000]${c.reset} [${barStr}] ${c.dim}[0xFFFFFFFF]${c.reset}`);

  // Legend
  const legendParts = servers.map((s, idx) => {
    const sColor = getServerColor(s.id, idx);
    const slices = serverSlices.get(s.id) ?? 0;
    const estShare = ((slices / sampleCount) * 100).toFixed(1);
    return `${sColor}■ ${s.id}${c.reset} ${c.dim}(~${estShare}% arc)${c.reset}`;
  });

  lines.push(`  ${c.dim}Legend:${c.reset} ${legendParts.join('  ')}`);
  lines.push('');

  return lines.join('\n');
}

/**
 * Formats a key migration plan upon server topology addition or removal.
 */
export function formatMigration(plan: MigrationPlan): string {
  const { targetServerId, movedKeys, totalMoved, percentageMoved } = plan;

  const targetColor = getServerColor(targetServerId);
  const lines: string[] = [
    `${c.bold}${c.white}MIGRATION ANALYSIS › Target Node: ${targetColor}${targetServerId}${c.reset}`,
    `${c.dim}────────────────────────────────────────────────────────────────────────${c.reset}`,
    `  ${c.dim}Candidate Node   :${c.reset} ${targetColor}${targetServerId}${c.reset}`,
    `  ${c.dim}Keys Reallocated :${c.reset} ${c.bold}${totalMoved}${c.reset} ${c.dim}(${percentageMoved.toFixed(2)}% of total keys)${c.reset}`,
    `  ${c.dim}Keys Preserved   :${c.reset} ${c.bold}${c.emerald}${(100 - percentageMoved).toFixed(2)}%${c.reset} ${c.dim}(untouched on existing nodes)${c.reset}`,
    '',
  ];

  if (movedKeys.length === 0) {
    lines.push(`  ${c.dim}(No keys need reallocation)${c.reset}`);
    return lines.join('\n');
  }

  // Source server breakdown
  const sourceBreakdown = new Map<string, number>();
  for (const item of movedKeys) {
    sourceBreakdown.set(item.fromServer, (sourceBreakdown.get(item.fromServer) ?? 0) + 1);
  }

  const headers = ['DONOR SERVER', 'KEYS SURRENDERED', 'CONTRIBUTION %'];
  const alignments: ('left' | 'right' | 'right')[] = ['left', 'right', 'right'];

  const rows: (string | number)[][] = Array.from(sourceBreakdown.entries()).map(([fromServer, count]) => {
    const sColor = getServerColor(fromServer);
    const percent = ((count / totalMoved) * 100).toFixed(1);
    return [`${sColor}${fromServer}${c.reset}`, count, `${percent}%`];
  });

  lines.push(`${c.dim}Migration Sources:${c.reset}`);
  lines.push(formatTable(headers, rows, alignments));
  lines.push('');

  // Sample keys
  const sampleCount = Math.min(10, movedKeys.length);
  const sampleKeys = movedKeys
    .slice(0, sampleCount)
    .map((k) => `${c.silver}${k.key}${c.reset} ${c.dim}(${k.fromServer} → ${targetServerId})${c.reset}`);

  lines.push(`  ${c.dim}Sample Migrated Keys (${sampleCount} of ${movedKeys.length}):${c.reset}`);
  lines.push(`  ${sampleKeys.join(', ')}${movedKeys.length > sampleCount ? ` ${c.dim}... +${movedKeys.length - sampleCount} more${c.reset}` : ''}`);

  return lines.join('\n');
}
