/**
 * diff command - Compare struct definitions between versions
 */

import { glob } from 'glob';
import chalk from 'chalk';
import { parseYamlFile, type ParsedFile } from '../lib/yaml-parser.js';
import {
  diff,
  diffStructs,
  diffWithSuggestions,
  detectHierarchyDeltas,
  type DiffResult,
  type StructDiff,
  type EnumDiff,
  type FieldChange,
  type FuncChange,
  type VFuncChange,
  type HierarchyDeltaCandidate,
  type CascadingPattern,
  type CrossHierarchyPattern,
  type PatchSuggestion,
} from '../lib/diff-engine.js';
import { toHex } from '../lib/types.js';

export interface DiffOptions {
  detectPatterns?: boolean;
  suggestPatches?: boolean;
  json?: boolean;
  summary?: boolean;
  structsOnly?: boolean;
  enumsOnly?: boolean;
}

/**
 * Run diff between old and new versions
 */
export async function runDiff(
  oldPattern: string,
  newPattern: string,
  options: DiffOptions
): Promise<void> {
  // Expand glob patterns for old version
  const oldPaths = await glob(oldPattern, { nodir: true });
  if (oldPaths.length === 0) {
    console.error(chalk.red(`No files found matching old pattern: ${oldPattern}`));
    process.exit(1);
  }

  // Expand glob patterns for new version
  const newPaths = await glob(newPattern, { nodir: true });
  if (newPaths.length === 0) {
    console.error(chalk.red(`No files found matching new pattern: ${newPattern}`));
    process.exit(1);
  }

  console.log(chalk.blue(`Comparing ${oldPaths.length} old file(s) with ${newPaths.length} new file(s)...\n`));

  // Parse old files
  const oldFiles: ParsedFile[] = [];
  for (const filePath of oldPaths) {
    try {
      const parsed = parseYamlFile(filePath);
      oldFiles.push(parsed);
    } catch (error) {
      console.error(chalk.red(`Failed to parse old file ${filePath}:`), error);
      process.exit(1);
    }
  }

  // Parse new files
  const newFiles: ParsedFile[] = [];
  for (const filePath of newPaths) {
    try {
      const parsed = parseYamlFile(filePath);
      newFiles.push(parsed);
    } catch (error) {
      console.error(chalk.red(`Failed to parse new file ${filePath}:`), error);
      process.exit(1);
    }
  }

  // Aggregate all structs and enums from each version
  const oldStructs = oldFiles.flatMap(f => f.structs);
  const newStructs = newFiles.flatMap(f => f.structs);
  const oldEnums = oldFiles.flatMap(f => f.enums);
  const newEnums = newFiles.flatMap(f => f.enums);

  // Run diff with or without suggestions
  let result: DiffResult;
  let hierarchyDeltas: HierarchyDeltaCandidate[] = [];
  let cascadingPatterns: CascadingPattern[] = [];
  let crossHierarchyPatterns: CrossHierarchyPattern[] = [];
  let patchSuggestions: PatchSuggestion[] = [];

  if (options.suggestPatches) {
    // Use enhanced diff with all pattern detection
    const enhanced = diffWithSuggestions(oldStructs, newStructs, oldEnums, newEnums);
    result = enhanced.result;
    hierarchyDeltas = enhanced.hierarchyDeltas;
    cascadingPatterns = enhanced.cascadingPatterns;
    crossHierarchyPatterns = enhanced.crossHierarchyPatterns;
    patchSuggestions = enhanced.patchSuggestions;
  } else {
    // Standard diff
    result = diff(oldStructs, newStructs, oldEnums, newEnums);

    // Detect hierarchy deltas for enhanced pattern display if requested
    if (options.detectPatterns) {
      const structDiffs = diffStructs(oldStructs, newStructs);
      hierarchyDeltas = detectHierarchyDeltas(oldStructs, newStructs, structDiffs);
    }
  }

  // Output results
  if (options.json) {
    const jsonResult = {
      ...result,
      hierarchyDeltas: (options.detectPatterns || options.suggestPatches) ? hierarchyDeltas : undefined,
      cascadingPatterns: options.suggestPatches ? cascadingPatterns : undefined,
      crossHierarchyPatterns: options.suggestPatches ? crossHierarchyPatterns : undefined,
      patchSuggestions: options.suggestPatches ? patchSuggestions : undefined,
    };
    console.log(JSON.stringify(jsonResult, null, 2));
    return;
  }

  // Print human-readable diff
  printDiffResult(result, options, hierarchyDeltas, cascadingPatterns, patchSuggestions);
}

/**
 * Print diff result in human-readable format
 */
function printDiffResult(
  result: DiffResult,
  options: DiffOptions,
  hierarchyDeltas: HierarchyDeltaCandidate[] = [],
  cascadingPatterns: CascadingPattern[] = [],
  patchSuggestions: PatchSuggestion[] = []
): void {
  const { structs, enums, patterns, stats } = result;

  // Print patch suggestions if available
  if (options.suggestPatches && patchSuggestions.length > 0) {
    printPatchSuggestions(patchSuggestions, cascadingPatterns);
  }

  // Print hierarchy-aware pattern analysis first if detected
  if ((options.detectPatterns || options.suggestPatches) && hierarchyDeltas.length > 0) {
    printHierarchyPatterns(hierarchyDeltas);
  } else if (options.detectPatterns && patterns.summary !== 'No consistent patterns detected') {
    // Fallback to original pattern display
    console.log(chalk.magenta.bold('Pattern Analysis'));
    console.log(chalk.magenta('─────────────────'));
    console.log(patterns.summary);
    console.log();
  }

  // Print struct changes
  if (!options.enumsOnly) {
    const addedStructs = structs.filter(d => d.type === 'added');
    const removedStructs = structs.filter(d => d.type === 'removed');
    const modifiedStructs = structs.filter(d => d.type === 'modified');

    if (addedStructs.length > 0) {
      console.log(chalk.green.bold(`Added Structs (${addedStructs.length})`));
      console.log(chalk.green('─────────────────'));
      for (const s of addedStructs) {
        console.log(chalk.green(`  + ${s.structName}`) +
          (s.newSize ? chalk.gray(` (size: ${toHex(s.newSize)})`) : ''));
      }
      console.log();
    }

    if (removedStructs.length > 0) {
      console.log(chalk.red.bold(`Removed Structs (${removedStructs.length})`));
      console.log(chalk.red('─────────────────'));
      for (const s of removedStructs) {
        console.log(chalk.red(`  - ${s.structName}`) +
          (s.oldSize ? chalk.gray(` (size: ${toHex(s.oldSize)})`) : ''));
      }
      console.log();
    }

    if (modifiedStructs.length > 0) {
      console.log(chalk.yellow.bold(`Modified Structs (${modifiedStructs.length})`));
      console.log(chalk.yellow('─────────────────'));
      for (const s of modifiedStructs) {
        printStructDiff(s, options);
      }
      console.log();
    }
  }

  // Print enum changes
  if (!options.structsOnly) {
    const addedEnums = enums.filter(d => d.type === 'added');
    const removedEnums = enums.filter(d => d.type === 'removed');
    const modifiedEnums = enums.filter(d => d.type === 'modified');

    if (addedEnums.length > 0) {
      console.log(chalk.green.bold(`Added Enums (${addedEnums.length})`));
      console.log(chalk.green('─────────────────'));
      for (const e of addedEnums) {
        console.log(chalk.green(`  + ${e.enumName}`));
      }
      console.log();
    }

    if (removedEnums.length > 0) {
      console.log(chalk.red.bold(`Removed Enums (${removedEnums.length})`));
      console.log(chalk.red('─────────────────'));
      for (const e of removedEnums) {
        console.log(chalk.red(`  - ${e.enumName}`));
      }
      console.log();
    }

    if (modifiedEnums.length > 0) {
      console.log(chalk.yellow.bold(`Modified Enums (${modifiedEnums.length})`));
      console.log(chalk.yellow('─────────────────'));
      for (const e of modifiedEnums) {
        printEnumDiff(e);
      }
      console.log();
    }
  }

  // Print summary
  console.log(chalk.blue.bold('Summary'));
  console.log(chalk.blue('─────────────────'));
  console.log(`Structs: ${chalk.green(`+${stats.structsAdded}`)} ${chalk.red(`-${stats.structsRemoved}`)} ${chalk.yellow(`~${stats.structsModified}`)}`);
  console.log(`Enums:   ${chalk.green(`+${stats.enumsAdded}`)} ${chalk.red(`-${stats.enumsRemoved}`)} ${chalk.yellow(`~${stats.enumsModified}`)}`);
  console.log(`Field changes: ${stats.totalFieldChanges}`);
  console.log(`Function changes: ${stats.totalFuncChanges}`);

  if (stats.structsAdded === 0 && stats.structsRemoved === 0 && stats.structsModified === 0 &&
      stats.enumsAdded === 0 && stats.enumsRemoved === 0 && stats.enumsModified === 0) {
    console.log(chalk.green('\n✓ No differences found'));
  }
}

/**
 * Print a single struct diff
 */
function printStructDiff(diff: StructDiff, options: DiffOptions): void {
  let header = `  ${diff.structName}`;

  // Show size change if applicable
  if (diff.oldSize !== undefined && diff.newSize !== undefined && diff.oldSize !== diff.newSize) {
    const delta = diff.newSize - diff.oldSize;
    const sign = delta > 0 ? '+' : '';
    header += chalk.gray(` (size: ${toHex(diff.oldSize)} → ${toHex(diff.newSize)}, ${sign}${toHex(delta)})`);
  }

  console.log(chalk.yellow(header));

  // Print field changes
  for (const change of diff.fieldChanges) {
    printFieldChange(change);
  }

  // Print function changes
  for (const change of diff.funcChanges) {
    printFuncChange(change);
  }

  // Print vfunc changes
  for (const change of diff.vfuncChanges) {
    printVFuncChange(change);
  }
}

/**
 * Print a field change
 */
function printFieldChange(change: FieldChange): void {
  const prefix = getChangePrefix(change.type);
  const color = getChangeColor(change.type);

  if (change.type === 'added') {
    console.log(color(`    ${prefix} ${change.fieldName}: ${change.fieldType} @ ${toHex(change.newOffset || 0)}`));
  } else if (change.type === 'removed') {
    console.log(color(`    ${prefix} ${change.fieldName}: ${change.fieldType} @ ${toHex(change.oldOffset || 0)}`));
  } else {
    // Modified - show what changed
    const parts: string[] = [];

    if (change.oldOffset !== change.newOffset) {
      const delta = (change.newOffset || 0) - (change.oldOffset || 0);
      const sign = delta > 0 ? '+' : '';
      parts.push(`offset: ${toHex(change.oldOffset || 0)} → ${toHex(change.newOffset || 0)} (${sign}${toHex(delta)})`);
    }

    if (change.oldType !== change.newType) {
      parts.push(`type: ${change.oldType} → ${change.newType}`);
    }

    if (change.oldSize !== change.newSize) {
      parts.push(`size: ${change.oldSize} → ${change.newSize}`);
    }

    console.log(color(`    ${prefix} ${change.fieldName}: ${parts.join(', ')}`));
  }
}

/**
 * Print a function change
 */
function printFuncChange(change: FuncChange): void {
  const prefix = getChangePrefix(change.type);
  const color = getChangeColor(change.type);

  if (change.type === 'added') {
    console.log(color(`    ${prefix} func ${change.funcName} @ ${toHex(change.newAddress || 0)}`));
  } else if (change.type === 'removed') {
    console.log(color(`    ${prefix} func ${change.funcName} @ ${toHex(change.oldAddress || 0)}`));
  } else {
    const parts: string[] = [];

    if (change.oldAddress !== change.newAddress) {
      const delta = (change.newAddress || 0) - (change.oldAddress || 0);
      const sign = delta > 0 ? '+' : '';
      parts.push(`addr: ${toHex(change.oldAddress || 0)} → ${toHex(change.newAddress || 0)} (${sign}${toHex(delta)})`);
    }

    if (change.oldSignature !== change.newSignature) {
      parts.push(`sig changed`);
    }

    console.log(color(`    ${prefix} func ${change.funcName}: ${parts.join(', ')}`));
  }
}

/**
 * Print a vfunc change
 */
function printVFuncChange(change: VFuncChange): void {
  const prefix = getChangePrefix(change.type);
  const color = getChangeColor(change.type);

  if (change.type === 'added') {
    console.log(color(`    ${prefix} vfunc ${change.funcName} (slot ${change.newId})`));
  } else if (change.type === 'removed') {
    console.log(color(`    ${prefix} vfunc ${change.funcName} (slot ${change.oldId})`));
  } else {
    const parts: string[] = [];

    if (change.oldId !== change.newId) {
      const delta = (change.newId || 0) - (change.oldId || 0);
      const sign = delta > 0 ? '+' : '';
      parts.push(`slot: ${change.oldId} → ${change.newId} (${sign}${delta})`);
    }

    if (change.oldSignature !== change.newSignature) {
      parts.push(`sig changed`);
    }

    console.log(color(`    ${prefix} vfunc ${change.funcName}: ${parts.join(', ')}`));
  }
}

/**
 * Print enum diff
 */
function printEnumDiff(diff: EnumDiff): void {
  let header = `  ${diff.enumName}`;

  if (diff.oldUnderlying !== diff.newUnderlying) {
    header += chalk.gray(` (underlying: ${diff.oldUnderlying} → ${diff.newUnderlying})`);
  }

  console.log(chalk.yellow(header));

  for (const change of diff.valueChanges) {
    const prefix = getChangePrefix(change.type);
    const color = getChangeColor(change.type);

    if (change.type === 'added') {
      console.log(color(`    ${prefix} ${change.name} = ${change.newValue}`));
    } else if (change.type === 'removed') {
      console.log(color(`    ${prefix} ${change.name} = ${change.oldValue}`));
    } else {
      console.log(color(`    ${prefix} ${change.name}: ${change.oldValue} → ${change.newValue}`));
    }
  }
}

function getChangePrefix(type: string): string {
  switch (type) {
    case 'added': return '+';
    case 'removed': return '-';
    case 'modified': return '~';
    default: return '?';
  }
}

function getChangeColor(type: string): (text: string) => string {
  switch (type) {
    case 'added': return chalk.green;
    case 'removed': return chalk.red;
    case 'modified': return chalk.yellow;
    default: return chalk.white;
  }
}

/**
 * Print patch suggestions
 */
function printPatchSuggestions(
  suggestions: PatchSuggestion[],
  cascadingPatterns: CascadingPattern[]
): void {
  console.log(chalk.cyan.bold('═══════════════════════════════════════════════════════════════'));
  console.log(chalk.cyan.bold('  SUGGESTED PATCH COMMANDS'));
  console.log(chalk.cyan.bold('═══════════════════════════════════════════════════════════════'));
  console.log();

  // Print cascading patterns first if any
  if (cascadingPatterns.length > 0) {
    console.log(chalk.yellow.bold('  Cascading Patterns Detected:'));
    console.log(chalk.yellow('  ─────────────────────────────'));
    for (const cp of cascadingPatterns) {
      const sign = cp.sizeDelta > 0 ? '+' : '';
      console.log(chalk.white(`  • ${cp.sourceStruct} size changed ${sign}${toHex(cp.sizeDelta)}`));
      console.log(chalk.gray(`    → Affects ${cp.affectedStructs.length} child struct(s): ${cp.affectedStructs.slice(0, 3).join(', ')}${cp.affectedStructs.length > 3 ? '...' : ''}`));
    }
    console.log();
  }

  // Group suggestions by confidence level
  const highConfidence = suggestions.filter(s => s.confidence >= 0.7);
  const mediumConfidence = suggestions.filter(s => s.confidence >= 0.5 && s.confidence < 0.7);

  if (highConfidence.length > 0) {
    console.log(chalk.green.bold('  High Confidence Patches (≥70%):'));
    console.log(chalk.green('  ────────────────────────────────'));
    for (const suggestion of highConfidence.slice(0, 10)) {
      printSuggestion(suggestion, chalk.green);
    }
    console.log();
  }

  if (mediumConfidence.length > 0) {
    console.log(chalk.yellow.bold('  Medium Confidence Patches (50-70%):'));
    console.log(chalk.yellow('  ────────────────────────────────────'));
    for (const suggestion of mediumConfidence.slice(0, 5)) {
      printSuggestion(suggestion, chalk.yellow);
    }
    console.log();
  }

  // Print summary
  console.log(chalk.cyan('───────────────────────────────────────────────────────────────'));
  console.log(chalk.white(`  Total: ${suggestions.length} patch suggestions`));
  console.log(chalk.white(`         ${highConfidence.length} high confidence, ${mediumConfidence.length} medium confidence`));
  console.log();
  console.log(chalk.gray('  Tip: Copy and run the suggested commands, or use --json for automation'));
  console.log(chalk.cyan('═══════════════════════════════════════════════════════════════'));
  console.log();
}

function printSuggestion(suggestion: PatchSuggestion, color: typeof chalk.green): void {
  const confidenceBar = '█'.repeat(Math.floor(suggestion.confidence * 10)) +
                        '░'.repeat(10 - Math.floor(suggestion.confidence * 10));
  console.log(color(`  [${confidenceBar}] ${(suggestion.confidence * 100).toFixed(0)}%`));
  console.log(chalk.white(`    ${suggestion.description}`));
  console.log(chalk.gray(`    $ ${suggestion.command}`));
  console.log();
}

/**
 * Print hierarchy-aware pattern analysis
 */
function printHierarchyPatterns(deltas: HierarchyDeltaCandidate[]): void {
  console.log(chalk.magenta.bold('═══════════════════════════════════════════════════════════════'));
  console.log(chalk.magenta.bold('  DETECTED PATTERNS (by inheritance hierarchy)'));
  console.log(chalk.magenta.bold('═══════════════════════════════════════════════════════════════'));
  console.log();

  for (const delta of deltas) {
    const sign = delta.delta >= 0 ? '+' : '';
    const confidenceBar = '█'.repeat(Math.floor(delta.confidence * 10)) +
                          '░'.repeat(10 - Math.floor(delta.confidence * 10));
    const confidenceColor = delta.confidence >= 0.7 ? chalk.green :
                            delta.confidence >= 0.5 ? chalk.yellow : chalk.red;

    console.log(chalk.cyan.bold(`  ${delta.hierarchy} hierarchy`));
    console.log(chalk.white(`  ├─ Delta: ${chalk.yellow.bold(`${sign}${toHex(delta.delta)}`)} from offset ${toHex(delta.startOffset)}`));
    console.log(chalk.white(`  ├─ Confidence: [${confidenceColor(confidenceBar)}] ${(delta.confidence * 100).toFixed(0)}%`));
    console.log(chalk.white(`  ├─ Fields: ${delta.matchCount}/${delta.totalFields} match this pattern`));
    console.log(chalk.white(`  ├─ Structs: ${delta.structNames.length} (${delta.structNames.slice(0, 5).join(', ')}${delta.structNames.length > 5 ? '...' : ''})`));

    if (delta.anomalies.length > 0) {
      console.log(chalk.white(`  ├─ `) + chalk.yellow(`⚠ ${delta.anomalies.length} anomalies (different delta)`));
    }

    // Print suggested command
    const structPattern = delta.structNames.length === 1
      ? delta.hierarchy
      : `${delta.hierarchy}*`;
    const command = `ffxiv-struct-tools patch --delta ${sign}${toHex(delta.delta)} --start-offset ${toHex(delta.startOffset)} --struct "${structPattern}"`;

    console.log(chalk.white(`  └─ `) + chalk.gray(`Command: ${chalk.white(command)}`));
    console.log();
  }

  // Print summary
  const highConfidence = deltas.filter(d => d.confidence >= 0.7).length;
  const totalFields = deltas.reduce((sum, d) => sum + d.matchCount, 0);
  const totalStructs = new Set(deltas.flatMap(d => d.structNames)).size;

  console.log(chalk.magenta('───────────────────────────────────────────────────────────────'));
  console.log(chalk.white(`  Summary: ${deltas.length} hierarchies with detected deltas`));
  console.log(chalk.white(`           ${highConfidence} high confidence (≥70%), ${totalFields} fields, ${totalStructs} structs`));

  if (highConfidence > 0) {
    console.log();
    console.log(chalk.green.bold(`  ✓ Use 'patch --auto-detect' for automated patching workflow`));
  }

  console.log(chalk.magenta('═══════════════════════════════════════════════════════════════'));
  console.log();
}
