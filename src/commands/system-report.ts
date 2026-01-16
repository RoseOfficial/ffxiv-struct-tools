/**
 * system-report command - Generate reports for FFXIV arcane subsystems
 */

import { glob } from 'glob';
import chalk from 'chalk';
import { Command } from 'commander';
import { parseYamlFile, type ParsedFile } from '../lib/yaml-parser.js';
import {
  analyzeAgentSystem,
  analyzeAtkSystem,
  analyzeNetworkPackets,
  analyzeSingletons,
  analyzeAllSubsystems,
  type AgentSystemReport,
  type AtkSystemReport,
  type NetworkReport,
  type SingletonReport,
  type SystemReport,
  type AgentCategory,
  type AtkComponentType,
  type SingletonSubsystem,
} from '../lib/analyzers/subsystems.js';
import { toHex } from '../lib/types.js';

export interface SystemReportOptions {
  system?: string;
  json?: boolean;
  output?: string;
  detailed?: boolean;
}

type SubsystemType = 'agents' | 'atk' | 'network' | 'singletons' | 'all';

/**
 * Create the system-report command
 */
export function createSystemReportCommand(): Command {
  const cmd = new Command('system-report')
    .description('Generate reports for FFXIV arcane subsystems')
    .argument('<patterns...>', 'YAML file paths or glob patterns')
    .option('-s, --system <type>', 'Subsystem to analyze: agents, atk, network, singletons, all', 'all')
    .option('--json', 'Output as JSON')
    .option('-o, --output <path>', 'Output file path')
    .option('-d, --detailed', 'Include detailed breakdown')
    .action(async (patterns: string[], options: SystemReportOptions) => {
      await runSystemReport(patterns, options);
    });

  return cmd;
}

async function runSystemReport(
  patterns: string[],
  options: SystemReportOptions
): Promise<void> {
  // Expand glob patterns
  const files: string[] = [];
  for (const pattern of patterns) {
    const matches = await glob(pattern, { nodir: true });
    files.push(...matches);
  }

  if (files.length === 0) {
    console.error(chalk.red('No files found matching the provided patterns'));
    process.exit(1);
  }

  // Parse all YAML files
  const parsedFiles: ParsedFile[] = [];
  for (const file of files) {
    try {
      const parsed = parseYamlFile(file);
      parsedFiles.push(parsed);
    } catch (error) {
      console.error(chalk.red(`Failed to parse ${file}:`), error);
      process.exit(1);
    }
  }

  const allStructs = parsedFiles.flatMap(f => f.structs);
  const system = (options.system?.toLowerCase() || 'all') as SubsystemType;

  // Generate reports
  let report: Partial<SystemReport> = {};

  switch (system) {
    case 'agents':
      report.agents = analyzeAgentSystem(allStructs);
      break;
    case 'atk':
      report.atk = analyzeAtkSystem(allStructs);
      break;
    case 'network':
      report.network = analyzeNetworkPackets(allStructs);
      break;
    case 'singletons':
      report.singletons = analyzeSingletons(allStructs);
      break;
    case 'all':
      report = analyzeAllSubsystems(allStructs);
      break;
    default:
      console.error(chalk.red(`Unknown system type: ${system}`));
      console.log(chalk.gray('Available: agents, atk, network, singletons, all'));
      process.exit(1);
  }

  // Output
  if (options.json) {
    const output = JSON.stringify(convertMapsToObjects(report), null, 2);
    if (options.output) {
      const fs = await import('node:fs');
      fs.writeFileSync(options.output, output);
      console.log(chalk.green(`Report written to ${options.output}`));
    } else {
      console.log(output);
    }
  } else {
    formatReport(report, options.detailed || false);
  }
}

/**
 * Convert Maps to plain objects for JSON serialization
 */
function convertMapsToObjects(obj: unknown): unknown {
  if (obj instanceof Map) {
    const result: Record<string, unknown> = {};
    for (const [key, value] of obj) {
      result[String(key)] = convertMapsToObjects(value);
    }
    return result;
  }
  if (Array.isArray(obj)) {
    return obj.map(convertMapsToObjects);
  }
  if (obj && typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = convertMapsToObjects(value);
    }
    return result;
  }
  return obj;
}

/**
 * Format and print the report
 */
function formatReport(report: Partial<SystemReport>, detailed: boolean): void {
  console.log();

  if (report.agents) {
    formatAgentReport(report.agents, detailed);
  }

  if (report.atk) {
    formatAtkReport(report.atk, detailed);
  }

  if (report.network) {
    formatNetworkReport(report.network, detailed);
  }

  if (report.singletons) {
    formatSingletonReport(report.singletons, detailed);
  }
}

function formatAgentReport(report: AgentSystemReport, detailed: boolean): void {
  console.log(chalk.blue.bold('Agent System Report'));
  console.log(chalk.blue('═'.repeat(50)));
  console.log();

  // Summary
  console.log(chalk.white.bold('Summary'));
  console.log(`  Total Agents:     ${report.totalAgents}`);
  console.log(`  With Instance():  ${report.stats.withInstance} (${percent(report.stats.withInstance, report.totalAgents)})`);
  console.log(`  With VFuncs:      ${report.stats.withVfuncs}`);
  console.log(`  Average Size:     ${toHex(report.stats.avgSize)}`);
  console.log(`  Max VFuncs:       ${report.stats.maxVfuncs}`);
  console.log();

  // By category
  console.log(chalk.white.bold('By Category'));
  const categories: AgentCategory[] = ['Commerce', 'Communication', 'Inventory', 'Combat', 'Social', 'UI', 'World', 'Character', 'Quest', 'System', 'Unknown'];
  for (const cat of categories) {
    const agents = report.byCategory.get(cat);
    if (agents && agents.length > 0) {
      console.log(`  ${cat.padEnd(15)} ${chalk.cyan(agents.length.toString().padStart(3))} agents`);
      if (detailed) {
        for (const agent of agents.slice(0, 5)) {
          console.log(chalk.gray(`    - ${agent.name}${agent.size ? ` (${toHex(agent.size)})` : ''}`));
        }
        if (agents.length > 5) {
          console.log(chalk.gray(`    ... and ${agents.length - 5} more`));
        }
      }
    }
  }
  console.log();

  // Missing base
  if (report.missingBase.length > 0) {
    console.log(chalk.yellow.bold('Agents Without Proper Base Class'));
    for (const agent of report.missingBase.slice(0, 10)) {
      console.log(chalk.yellow(`  - ${agent.name} (base: ${agent.base || 'none'})`));
    }
    if (report.missingBase.length > 10) {
      console.log(chalk.yellow(`  ... and ${report.missingBase.length - 10} more`));
    }
    console.log();
  }
}

function formatAtkReport(report: AtkSystemReport, detailed: boolean): void {
  console.log(chalk.magenta.bold('ATK/UI Component Report'));
  console.log(chalk.magenta('═'.repeat(50)));
  console.log();

  // Summary
  console.log(chalk.white.bold('Summary'));
  console.log(`  Total Components: ${report.totalComponents}`);
  console.log(`  In ResNode Tree:  ${report.resNodeHierarchy.length}`);
  console.log(`  With VFuncs:      ${report.stats.withVfuncs}`);
  console.log(`  Average Size:     ${toHex(report.stats.avgSize)}`);
  console.log(`  Max VFuncs:       ${report.stats.maxVfuncs}`);
  console.log();

  // By type
  console.log(chalk.white.bold('By Component Type'));
  const types: AtkComponentType[] = ['Text', 'Image', 'Interactive', 'Container', 'Window', 'Input', 'Data', 'Base', 'Unknown'];
  for (const type of types) {
    const comps = report.byType.get(type);
    if (comps && comps.length > 0) {
      console.log(`  ${type.padEnd(12)} ${chalk.cyan(comps.length.toString().padStart(3))} components`);
      if (detailed) {
        for (const comp of comps.slice(0, 3)) {
          console.log(chalk.gray(`    - ${comp.name}${comp.size ? ` (${toHex(comp.size)})` : ''}`));
        }
        if (comps.length > 3) {
          console.log(chalk.gray(`    ... and ${comps.length - 3} more`));
        }
      }
    }
  }
  console.log();

  // Missing event listener
  if (report.missingEventListener.length > 0) {
    console.log(chalk.yellow.bold('Components Missing Event Listener'));
    for (const comp of report.missingEventListener.slice(0, 5)) {
      console.log(chalk.yellow(`  - ${comp.name}`));
    }
    if (report.missingEventListener.length > 5) {
      console.log(chalk.yellow(`  ... and ${report.missingEventListener.length - 5} more`));
    }
    console.log();
  }
}

function formatNetworkReport(report: NetworkReport, detailed: boolean): void {
  console.log(chalk.green.bold('Network Packet Report'));
  console.log(chalk.green('═'.repeat(50)));
  console.log();

  // Summary
  console.log(chalk.white.bold('Summary'));
  console.log(`  Total Packets:    ${report.totalPackets}`);
  console.log(`  Client → Server:  ${report.byDirection.client.length}`);
  console.log(`  Server → Client:  ${report.byDirection.server.length}`);
  console.log(`  Bidirectional:    ${report.byDirection.bidirectional.length}`);
  console.log(`  Unknown:          ${report.byDirection.unknown.length}`);
  console.log();

  // Size distribution
  console.log(chalk.white.bold('Size Distribution'));
  console.log(`  Small (<64B):     ${report.sizeDistribution.small}`);
  console.log(`  Medium (64-256B): ${report.sizeDistribution.medium}`);
  console.log(`  Large (>256B):    ${report.sizeDistribution.large}`);
  console.log();

  // Size stats
  if (report.stats.avgSize > 0) {
    console.log(chalk.white.bold('Size Statistics'));
    console.log(`  Average:          ${toHex(report.stats.avgSize)}`);
    console.log(`  Minimum:          ${toHex(report.stats.minSize)}`);
    console.log(`  Maximum:          ${toHex(report.stats.maxSize)}`);
    console.log();
  }

  // Common patterns
  if (report.commonPatterns.length > 0) {
    console.log(chalk.white.bold('Common Field Patterns'));
    for (const pattern of report.commonPatterns) {
      console.log(`  ${pattern.pattern.padEnd(15)} found in ${chalk.cyan(pattern.count.toString())} packets`);
    }
    console.log();
  }

  // Detailed listing
  if (detailed && report.byDirection.client.length > 0) {
    console.log(chalk.white.bold('Client → Server Packets'));
    for (const packet of report.byDirection.client.slice(0, 10)) {
      console.log(chalk.gray(`  - ${packet.name}${packet.size ? ` (${toHex(packet.size)})` : ''}`));
    }
    if (report.byDirection.client.length > 10) {
      console.log(chalk.gray(`  ... and ${report.byDirection.client.length - 10} more`));
    }
    console.log();
  }
}

function formatSingletonReport(report: SingletonReport, detailed: boolean): void {
  console.log(chalk.cyan.bold('Singleton/Manager Report'));
  console.log(chalk.cyan('═'.repeat(50)));
  console.log();

  // Summary
  console.log(chalk.white.bold('Summary'));
  console.log(`  Total Singletons: ${report.totalSingletons}`);
  console.log(`  With Instance():  ${report.stats.withInstance} (${percent(report.stats.withInstance, report.totalSingletons)})`);
  console.log(`  With Initialize:  ${report.stats.withInitialize}`);
  console.log(`  Avg Dependencies: ${report.stats.avgDependencies}`);
  console.log();

  // By subsystem
  console.log(chalk.white.bold('By Subsystem'));
  const subsystems: SingletonSubsystem[] = ['UI', 'Network', 'Combat', 'Items', 'World', 'Social', 'Character', 'System', 'Audio', 'Graphics', 'Unknown'];
  for (const subsys of subsystems) {
    const singletons = report.bySubsystem.get(subsys);
    if (singletons && singletons.length > 0) {
      console.log(`  ${subsys.padEnd(12)} ${chalk.cyan(singletons.length.toString().padStart(3))} managers`);
      if (detailed) {
        for (const singleton of singletons.slice(0, 3)) {
          const instanceMark = singleton.hasInstance ? chalk.green('✓') : chalk.red('✗');
          console.log(chalk.gray(`    ${instanceMark} ${singleton.name}`));
        }
        if (singletons.length > 3) {
          console.log(chalk.gray(`    ... and ${singletons.length - 3} more`));
        }
      }
    }
  }
  console.log();

  // Missing Instance()
  if (report.missingInstance.length > 0) {
    console.log(chalk.yellow.bold('Potential Singletons Missing Instance()'));
    for (const singleton of report.missingInstance.slice(0, 10)) {
      console.log(chalk.yellow(`  - ${singleton.name}`));
    }
    if (report.missingInstance.length > 10) {
      console.log(chalk.yellow(`  ... and ${report.missingInstance.length - 10} more`));
    }
    console.log();
  }

  // Dependencies
  if (detailed && report.dependencyGroups.length > 0) {
    console.log(chalk.white.bold('Top Dependencies'));
    for (const group of report.dependencyGroups.slice(0, 5)) {
      console.log(`  ${group.singleton}`);
      for (const dep of group.dependencies.slice(0, 3)) {
        console.log(chalk.gray(`    → ${dep}`));
      }
      if (group.dependencies.length > 3) {
        console.log(chalk.gray(`    → ... and ${group.dependencies.length - 3} more`));
      }
    }
    console.log();
  }
}

function percent(value: number, total: number): string {
  if (total === 0) return '0%';
  return `${Math.round(value / total * 100)}%`;
}

export default createSystemReportCommand;
