/**
 * vtables command - Track vtable addresses and slot changes across versions
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { glob } from 'glob';
import chalk from 'chalk';
import { parseYamlFiles, type ParsedFile } from '../lib/yaml-parser.js';
import { toHex } from '../lib/types.js';
import type { YamlStruct, YamlVFunc } from '../lib/types.js';

// ============================================================================
// Types
// ============================================================================

export interface VTableEntry {
  /** Struct that owns this vtable */
  structName: string;
  /** Base struct (if inherited) */
  baseStruct?: string;
  /** Virtual functions in this vtable */
  vfuncs: {
    id: number;
    name?: string;
    signature?: string;
  }[];
  /** Total number of vfuncs including inherited */
  totalSlots: number;
}

export interface VTableReport {
  /** When this report was generated */
  generatedAt: string;
  /** Source path(s) */
  sourcePaths: string[];
  /** Version identifier */
  version?: string;
  /** All vtable entries */
  entries: VTableEntry[];
  /** Statistics */
  stats: {
    totalStructsWithVTables: number;
    totalVFuncs: number;
    maxSlotId: number;
  };
}

export interface VTableDiff {
  structName: string;
  type: 'added' | 'removed' | 'modified';
  oldSlots?: number;
  newSlots?: number;
  vfuncChanges: {
    type: 'added' | 'removed' | 'modified';
    name?: string;
    oldId?: number;
    newId?: number;
    oldSignature?: string;
    newSignature?: string;
  }[];
}

export interface VTableDiffResult {
  oldVersion?: string;
  newVersion?: string;
  diffs: VTableDiff[];
  stats: {
    structsAdded: number;
    structsRemoved: number;
    structsModified: number;
    vfuncsAdded: number;
    vfuncsRemoved: number;
    vfuncsModified: number;
  };
  /** Detected slot shift pattern (if any) */
  shiftPattern?: {
    delta: number;
    matchCount: number;
    confidence: number;
  };
}

export interface VTablesOptions {
  output?: string;
  version?: string;
  json?: boolean;
  format?: 'ida' | 'ghidra' | 'json';
}

// ============================================================================
// VTable Extraction
// ============================================================================

/**
 * Extract vtable information from parsed YAML files
 */
export function extractVTables(parsed: ParsedFile[]): VTableEntry[] {
  const entries: VTableEntry[] = [];
  const structMap = new Map<string, YamlStruct>();

  // Build struct map for inheritance lookup
  for (const file of parsed) {
    for (const struct of file.structs) {
      if (struct.type) {
        structMap.set(struct.type, struct);
      }
    }
  }

  // Extract vtables
  for (const file of parsed) {
    for (const struct of file.structs) {
      if (!struct.vfuncs || struct.vfuncs.length === 0) continue;

      const vfuncs = struct.vfuncs
        .filter((v): v is YamlVFunc & { id: number } => v.id !== undefined)
        .map(v => ({
          id: v.id,
          name: v.name,
          signature: v.signature,
        }))
        .sort((a, b) => a.id - b.id);

      if (vfuncs.length === 0) continue;

      const maxId = Math.max(...vfuncs.map(v => v.id));

      entries.push({
        structName: struct.type,
        baseStruct: struct.base,
        vfuncs,
        totalSlots: maxId + 1,
      });
    }
  }

  // Sort by struct name
  entries.sort((a, b) => a.structName.localeCompare(b.structName));

  return entries;
}

/**
 * Generate a vtable report from YAML files
 */
export function generateVTableReport(
  parsed: ParsedFile[],
  options: { version?: string; sourcePaths?: string[] } = {}
): VTableReport {
  const entries = extractVTables(parsed);

  const totalVFuncs = entries.reduce((sum, e) => sum + e.vfuncs.length, 0);
  const maxSlotId = entries.reduce((max, e) =>
    Math.max(max, ...e.vfuncs.map(v => v.id)), 0
  );

  return {
    generatedAt: new Date().toISOString(),
    sourcePaths: options.sourcePaths || [],
    version: options.version,
    entries,
    stats: {
      totalStructsWithVTables: entries.length,
      totalVFuncs,
      maxSlotId,
    },
  };
}

// ============================================================================
// VTable Diff
// ============================================================================

/**
 * Compare two vtable reports
 */
export function diffVTables(
  oldReport: VTableReport,
  newReport: VTableReport
): VTableDiffResult {
  const diffs: VTableDiff[] = [];
  const oldMap = new Map(oldReport.entries.map(e => [e.structName, e]));
  const newMap = new Map(newReport.entries.map(e => [e.structName, e]));

  let vfuncsAdded = 0;
  let vfuncsRemoved = 0;
  let vfuncsModified = 0;

  // Find added and modified
  for (const [name, newEntry] of newMap) {
    const oldEntry = oldMap.get(name);

    if (!oldEntry) {
      diffs.push({
        structName: name,
        type: 'added',
        newSlots: newEntry.totalSlots,
        vfuncChanges: newEntry.vfuncs.map(v => ({
          type: 'added',
          name: v.name,
          newId: v.id,
          newSignature: v.signature,
        })),
      });
      vfuncsAdded += newEntry.vfuncs.length;
    } else {
      const vfuncChanges = diffVFuncs(oldEntry.vfuncs, newEntry.vfuncs);

      if (vfuncChanges.length > 0 || oldEntry.totalSlots !== newEntry.totalSlots) {
        diffs.push({
          structName: name,
          type: 'modified',
          oldSlots: oldEntry.totalSlots,
          newSlots: newEntry.totalSlots,
          vfuncChanges,
        });

        for (const change of vfuncChanges) {
          if (change.type === 'added') vfuncsAdded++;
          else if (change.type === 'removed') vfuncsRemoved++;
          else vfuncsModified++;
        }
      }
    }
  }

  // Find removed
  for (const [name, oldEntry] of oldMap) {
    if (!newMap.has(name)) {
      diffs.push({
        structName: name,
        type: 'removed',
        oldSlots: oldEntry.totalSlots,
        vfuncChanges: oldEntry.vfuncs.map(v => ({
          type: 'removed',
          name: v.name,
          oldId: v.id,
          oldSignature: v.signature,
        })),
      });
      vfuncsRemoved += oldEntry.vfuncs.length;
    }
  }

  // Detect shift pattern
  const shiftPattern = detectVFuncShiftPattern(diffs);

  return {
    oldVersion: oldReport.version,
    newVersion: newReport.version,
    diffs: diffs.sort((a, b) => a.structName.localeCompare(b.structName)),
    stats: {
      structsAdded: diffs.filter(d => d.type === 'added').length,
      structsRemoved: diffs.filter(d => d.type === 'removed').length,
      structsModified: diffs.filter(d => d.type === 'modified').length,
      vfuncsAdded,
      vfuncsRemoved,
      vfuncsModified,
    },
    shiftPattern,
  };
}

/**
 * Diff vfunc arrays
 */
function diffVFuncs(
  oldVFuncs: VTableEntry['vfuncs'],
  newVFuncs: VTableEntry['vfuncs']
): VTableDiff['vfuncChanges'] {
  const changes: VTableDiff['vfuncChanges'] = [];

  const oldByName = new Map(oldVFuncs.filter(v => v.name).map(v => [v.name!, v]));
  const newByName = new Map(newVFuncs.filter(v => v.name).map(v => [v.name!, v]));

  // Find removed
  for (const [name, oldV] of oldByName) {
    if (!newByName.has(name)) {
      changes.push({
        type: 'removed',
        name,
        oldId: oldV.id,
        oldSignature: oldV.signature,
      });
    }
  }

  // Find added and modified
  for (const [name, newV] of newByName) {
    const oldV = oldByName.get(name);

    if (!oldV) {
      changes.push({
        type: 'added',
        name,
        newId: newV.id,
        newSignature: newV.signature,
      });
    } else {
      const idChanged = oldV.id !== newV.id;
      const sigChanged = oldV.signature !== newV.signature;

      if (idChanged || sigChanged) {
        changes.push({
          type: 'modified',
          name,
          oldId: oldV.id,
          newId: newV.id,
          oldSignature: oldV.signature,
          newSignature: newV.signature,
        });
      }
    }
  }

  return changes;
}

/**
 * Detect if there's a consistent slot shift pattern
 */
function detectVFuncShiftPattern(
  diffs: VTableDiff[]
): VTableDiffResult['shiftPattern'] {
  const deltas: number[] = [];

  for (const diff of diffs) {
    if (diff.type !== 'modified') continue;

    for (const change of diff.vfuncChanges) {
      if (change.type === 'modified' && change.oldId !== undefined && change.newId !== undefined) {
        deltas.push(change.newId - change.oldId);
      }
    }
  }

  if (deltas.length < 2) return undefined;

  // Find most common delta
  const counts = new Map<number, number>();
  for (const delta of deltas) {
    counts.set(delta, (counts.get(delta) || 0) + 1);
  }

  let maxCount = 0;
  let mostCommonDelta = 0;

  for (const [delta, count] of counts) {
    if (count > maxCount) {
      maxCount = count;
      mostCommonDelta = delta;
    }
  }

  const confidence = maxCount / deltas.length;

  if (confidence < 0.5) return undefined;

  return {
    delta: mostCommonDelta,
    matchCount: maxCount,
    confidence,
  };
}

// ============================================================================
// Export Formats
// ============================================================================

/**
 * Export vtable report to IDA Python script
 */
export function exportVTablesToIDA(report: VTableReport): string {
  const lines: string[] = [
    '# Auto-generated VTable definitions for IDA Pro',
    `# Generated: ${report.generatedAt}`,
    `# Version: ${report.version || 'unknown'}`,
    '',
    'import idaapi',
    'import idc',
    '',
    'def define_vtables():',
    '    """Define vtable structures"""',
    '',
  ];

  for (const entry of report.entries) {
    lines.push(`    # ${entry.structName} vtable`);
    lines.push(`    # Slots: ${entry.totalSlots}`);

    for (const vfunc of entry.vfuncs) {
      const name = vfunc.name || `vfunc_${vfunc.id}`;
      lines.push(`    # Slot ${vfunc.id}: ${name}`);
    }
    lines.push('');
  }

  lines.push('if __name__ == "__main__":');
  lines.push('    define_vtables()');

  return lines.join('\n');
}

/**
 * Export vtable report to Ghidra Python script
 */
export function exportVTablesToGhidra(report: VTableReport): string {
  const lines: string[] = [
    '# Auto-generated VTable definitions for Ghidra',
    `# Generated: ${report.generatedAt}`,
    `# Version: ${report.version || 'unknown'}`,
    '',
    'from ghidra.program.model.data import *',
    'from ghidra.program.model.symbol import *',
    '',
    'def define_vtables():',
    '    """Define vtable structures"""',
    '    dtm = currentProgram.getDataTypeManager()',
    '',
  ];

  for (const entry of report.entries) {
    lines.push(`    # ${entry.structName} vtable (${entry.totalSlots} slots)`);
    for (const vfunc of entry.vfuncs) {
      const name = vfunc.name || `vfunc_${vfunc.id}`;
      lines.push(`    # Slot ${vfunc.id}: ${name}`);
    }
    lines.push('');
  }

  lines.push('if __name__ == "__main__":');
  lines.push('    define_vtables()');

  return lines.join('\n');
}

// ============================================================================
// Command Handlers
// ============================================================================

/**
 * Run vtables extract command
 */
export async function runVTablesExtract(
  patterns: string[],
  options: VTablesOptions
): Promise<void> {
  // Expand patterns
  const filePaths: string[] = [];
  for (const pattern of patterns) {
    const matches = await glob(pattern, { nodir: true });
    filePaths.push(...matches);
  }

  if (filePaths.length === 0) {
    console.error(chalk.red('No files found matching the provided patterns'));
    process.exit(1);
  }

  console.log(chalk.blue(`Extracting vtables from ${filePaths.length} file(s)...`));

  const parsed = parseYamlFiles(filePaths);
  const report = generateVTableReport(parsed, {
    version: options.version,
    sourcePaths: filePaths,
  });

  // Output based on format
  if (options.format === 'ida') {
    const output = exportVTablesToIDA(report);
    if (options.output) {
      writeFileSync(options.output, output, 'utf-8');
      console.log(chalk.green(`✓ Written to ${options.output}`));
    } else {
      console.log(output);
    }
  } else if (options.format === 'ghidra') {
    const output = exportVTablesToGhidra(report);
    if (options.output) {
      writeFileSync(options.output, output, 'utf-8');
      console.log(chalk.green(`✓ Written to ${options.output}`));
    } else {
      console.log(output);
    }
  } else if (options.json || options.format === 'json') {
    const output = JSON.stringify(report, null, 2);
    if (options.output) {
      writeFileSync(options.output, output, 'utf-8');
      console.log(chalk.green(`✓ Written to ${options.output}`));
    } else {
      console.log(output);
    }
  } else {
    // Human-readable format
    printVTableReport(report);
  }
}

/**
 * Run vtables diff command
 */
export async function runVTablesDiff(
  oldPath: string,
  newPath: string,
  options: VTablesOptions
): Promise<void> {
  // Load old report (or extract from YAML)
  const oldReport = await loadOrExtractReport(oldPath, 'old');
  const newReport = await loadOrExtractReport(newPath, 'new');

  const diffResult = diffVTables(oldReport, newReport);

  if (options.json) {
    console.log(JSON.stringify(diffResult, null, 2));
    return;
  }

  printVTableDiff(diffResult);
}

/**
 * Load existing report or extract from YAML files
 */
async function loadOrExtractReport(
  path: string,
  label: string
): Promise<VTableReport> {
  // Check if it's a JSON file
  if (path.endsWith('.json')) {
    if (!existsSync(path)) {
      console.error(chalk.red(`${label} report not found: ${path}`));
      process.exit(1);
    }
    const content = readFileSync(path, 'utf-8');
    return JSON.parse(content) as VTableReport;
  }

  // Otherwise, treat as YAML path
  const patterns = path.includes('*') ? [path] : [`${path}/**/*.yml`, `${path}/**/*.yaml`];
  const filePaths: string[] = [];

  for (const pattern of patterns) {
    const matches = await glob(pattern, { nodir: true });
    filePaths.push(...matches);
  }

  if (filePaths.length === 0) {
    console.error(chalk.red(`No files found for ${label}: ${path}`));
    process.exit(1);
  }

  const parsed = parseYamlFiles(filePaths);
  return generateVTableReport(parsed, { sourcePaths: filePaths });
}

// ============================================================================
// Display Helpers
// ============================================================================

/**
 * Print vtable report
 */
function printVTableReport(report: VTableReport): void {
  console.log(chalk.blue.bold('═══════════════════════════════════════════════════════════'));
  console.log(chalk.blue.bold('  VTable Report'));
  console.log(chalk.blue.bold('═══════════════════════════════════════════════════════════'));
  console.log();

  console.log(chalk.white(`  Generated: ${report.generatedAt}`));
  if (report.version) {
    console.log(chalk.white(`  Version: ${report.version}`));
  }
  console.log(chalk.white(`  Structs with VTables: ${report.stats.totalStructsWithVTables}`));
  console.log(chalk.white(`  Total VFuncs: ${report.stats.totalVFuncs}`));
  console.log(chalk.white(`  Max Slot ID: ${report.stats.maxSlotId}`));
  console.log();

  for (const entry of report.entries) {
    console.log(chalk.cyan.bold(`  ${entry.structName}`));
    if (entry.baseStruct) {
      console.log(chalk.gray(`    Base: ${entry.baseStruct}`));
    }
    console.log(chalk.gray(`    Slots: ${entry.totalSlots} (${entry.vfuncs.length} defined)`));

    for (const vfunc of entry.vfuncs.slice(0, 5)) {
      const name = vfunc.name || chalk.gray('unnamed');
      console.log(chalk.white(`      [${vfunc.id}] ${name}`));
    }

    if (entry.vfuncs.length > 5) {
      console.log(chalk.gray(`      ... and ${entry.vfuncs.length - 5} more`));
    }
    console.log();
  }
}

/**
 * Print vtable diff
 */
function printVTableDiff(result: VTableDiffResult): void {
  console.log(chalk.blue.bold('═══════════════════════════════════════════════════════════'));
  console.log(chalk.blue.bold('  VTable Diff'));
  console.log(chalk.blue.bold('═══════════════════════════════════════════════════════════'));
  console.log();

  if (result.oldVersion || result.newVersion) {
    console.log(chalk.white(`  ${result.oldVersion || '?'} → ${result.newVersion || '?'}`));
    console.log();
  }

  // Show shift pattern if detected
  if (result.shiftPattern) {
    const sign = result.shiftPattern.delta >= 0 ? '+' : '';
    console.log(chalk.magenta.bold('  PATTERN DETECTED'));
    console.log(chalk.magenta(`  Slot shift: ${sign}${result.shiftPattern.delta}`));
    console.log(chalk.magenta(`  Matches: ${result.shiftPattern.matchCount} (${(result.shiftPattern.confidence * 100).toFixed(0)}% confidence)`));
    console.log();
  }

  // Added
  const added = result.diffs.filter(d => d.type === 'added');
  if (added.length > 0) {
    console.log(chalk.green.bold(`  Added VTables (${added.length})`));
    for (const d of added) {
      console.log(chalk.green(`    + ${d.structName} (${d.newSlots} slots)`));
    }
    console.log();
  }

  // Removed
  const removed = result.diffs.filter(d => d.type === 'removed');
  if (removed.length > 0) {
    console.log(chalk.red.bold(`  Removed VTables (${removed.length})`));
    for (const d of removed) {
      console.log(chalk.red(`    - ${d.structName} (${d.oldSlots} slots)`));
    }
    console.log();
  }

  // Modified
  const modified = result.diffs.filter(d => d.type === 'modified');
  if (modified.length > 0) {
    console.log(chalk.yellow.bold(`  Modified VTables (${modified.length})`));
    for (const d of modified) {
      let header = `    ~ ${d.structName}`;
      if (d.oldSlots !== d.newSlots) {
        header += chalk.gray(` (${d.oldSlots} → ${d.newSlots} slots)`);
      }
      console.log(chalk.yellow(header));

      for (const change of d.vfuncChanges.slice(0, 3)) {
        if (change.type === 'added') {
          console.log(chalk.green(`        + [${change.newId}] ${change.name || 'unnamed'}`));
        } else if (change.type === 'removed') {
          console.log(chalk.red(`        - [${change.oldId}] ${change.name || 'unnamed'}`));
        } else {
          const slotChange = change.oldId !== change.newId
            ? ` slot: ${change.oldId} → ${change.newId}`
            : '';
          console.log(chalk.yellow(`        ~ ${change.name || 'unnamed'}${slotChange}`));
        }
      }

      if (d.vfuncChanges.length > 3) {
        console.log(chalk.gray(`        ... and ${d.vfuncChanges.length - 3} more changes`));
      }
    }
    console.log();
  }

  // Summary
  console.log(chalk.blue('───────────────────────────────────────────────────────────'));
  console.log(chalk.white(`  Summary: ${result.diffs.length} vtables changed`));
  console.log(chalk.white(`    +${result.stats.structsAdded} -${result.stats.structsRemoved} ~${result.stats.structsModified} structs`));
  console.log(chalk.white(`    +${result.stats.vfuncsAdded} -${result.stats.vfuncsRemoved} ~${result.stats.vfuncsModified} vfuncs`));
}
