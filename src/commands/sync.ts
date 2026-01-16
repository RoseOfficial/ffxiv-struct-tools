/**
 * sync command - Bidirectional synchronization between YAML and ReClass.NET
 *
 * Merges changes between YAML struct definitions and ReClass.NET files
 * with configurable conflict resolution strategies.
 */

import * as fs from 'fs';
import * as path from 'path';
import { glob } from 'glob';
import chalk from 'chalk';
import { Command } from 'commander';
import { parseYamlFile, type ParsedFile } from '../lib/yaml-parser.js';
import { serializeYaml } from '../lib/yaml-serializer.js';
import { importReclass } from '../lib/importers/reclass.js';
import { reclassExporter } from '../lib/exporters/reclass.js';
import { toHex, type YamlData, type YamlStruct, type YamlEnum } from '../lib/types.js';
import {
  syncData,
  generateDiffSummary,
  type SyncOptions,
  type SyncResult,
  type SyncDirection,
  type ConflictStrategy,
} from '../lib/sync-engine.js';

// ============================================================================
// Types
// ============================================================================

export interface SyncCommandOptions {
  /** ReClass.NET file to sync with */
  reclass?: string;
  /** Sync direction */
  direction?: string;
  /** Conflict resolution strategy */
  conflict?: string;
  /** Preview changes without writing */
  dryRun?: boolean;
  /** Output as JSON */
  json?: boolean;
  /** Output path for merged YAML */
  output?: string;
  /** Minimum confidence for auto-accepting changes */
  minConfidence?: string;
  /** Preserve field names from YAML */
  preserveNames?: boolean;
  /** Preserve field types from YAML */
  preserveTypes?: boolean;
}

// ============================================================================
// Sync Command Implementation
// ============================================================================

/**
 * Run the sync command
 */
export async function runSync(
  yamlPatterns: string[],
  options: SyncCommandOptions
): Promise<void> {
  // Validate options
  if (!options.reclass) {
    console.error(chalk.red('Error: --reclass option is required'));
    process.exit(1);
  }

  // Parse direction
  const direction = parseDirection(options.direction || 'bidirectional');

  // Parse conflict strategy
  const conflictStrategy = parseConflictStrategy(options.conflict || 'prefer-yaml');

  // Expand YAML glob patterns
  const yamlPaths: string[] = [];
  for (const pattern of yamlPatterns) {
    const matches = await glob(pattern, { nodir: true });
    yamlPaths.push(...matches);
  }

  if (yamlPaths.length === 0) {
    console.error(chalk.red('No YAML files found matching the provided patterns'));
    process.exit(1);
  }

  // Check ReClass file exists
  if (!fs.existsSync(options.reclass)) {
    console.error(chalk.red(`ReClass file not found: ${options.reclass}`));
    process.exit(1);
  }

  console.log(chalk.blue(`Loading ${yamlPaths.length} YAML file(s)...`));

  // Parse YAML files
  const yamlStructs: YamlStruct[] = [];
  const yamlEnums: YamlEnum[] = [];
  for (const yamlPath of yamlPaths) {
    try {
      const parsed = parseYamlFile(yamlPath);
      yamlStructs.push(...parsed.structs);
      yamlEnums.push(...parsed.enums);
    } catch (error) {
      console.error(chalk.red(`Failed to parse ${yamlPath}:`), error);
      process.exit(1);
    }
  }
  const yamlData: YamlData = { structs: yamlStructs, enums: yamlEnums };

  console.log(chalk.blue(`Loading ReClass file: ${options.reclass}`));

  // Parse ReClass file
  let reclassData: YamlData;
  try {
    const reclassContent = fs.readFileSync(options.reclass, 'utf-8');
    const importResult = importReclass(reclassContent);
    reclassData = importResult.data;

    if (importResult.warnings.length > 0) {
      for (const warning of importResult.warnings) {
        console.warn(chalk.yellow(`  Warning: ${warning}`));
      }
    }
  } catch (error) {
    console.error(chalk.red(`Failed to parse ReClass file:`), error);
    process.exit(1);
  }

  console.log(chalk.gray(`  YAML: ${yamlData.structs?.length || 0} structs, ${yamlData.enums?.length || 0} enums`));
  console.log(chalk.gray(`  ReClass: ${reclassData.structs?.length || 0} structs, ${reclassData.enums?.length || 0} enums`));

  // Build sync options
  const syncOptions: SyncOptions = {
    direction,
    conflictStrategy,
    preserveNames: options.preserveNames !== false,
    preserveTypes: options.preserveTypes !== false,
    preserveNotes: true,
    minConfidence: parseInt(options.minConfidence || '70', 10),
  };

  console.log(chalk.blue(`\nSynchronizing (${direction}, conflicts: ${conflictStrategy})...\n`));

  // Run sync
  const result = syncData(yamlData, reclassData, syncOptions);

  // Output results
  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  // Print summary
  printSyncSummary(result);

  // Check for unresolved conflicts
  if (result.unresolvedConflicts.length > 0) {
    console.log(chalk.yellow(`\n⚠ ${result.unresolvedConflicts.length} unresolved conflict(s) require manual resolution`));
    console.log(chalk.gray('  Use --conflict prefer-yaml or --conflict prefer-reclass to auto-resolve'));

    if (!options.dryRun) {
      console.log(chalk.red('\nNo files written due to unresolved conflicts'));
    }
    process.exit(1);
  }

  // Dry run - just show what would change
  if (options.dryRun) {
    console.log(chalk.blue('\n───────────────────────────────────────────────────────────────'));
    console.log(chalk.blue('Dry Run - No files will be written'));
    console.log(chalk.blue('───────────────────────────────────────────────────────────────\n'));

    console.log(generateDiffSummary(result));
    return;
  }

  // Write merged results
  if (result.merged) {
    // Determine output path
    const outputPath = options.output || yamlPaths[0];

    // Write YAML if direction includes yaml updates
    if (direction !== 'yaml-to-reclass') {
      const yamlContent = serializeYaml(result.merged);
      fs.writeFileSync(outputPath, yamlContent);
      console.log(chalk.green(`\n✓ YAML written to: ${outputPath}`));
    }

    // Write ReClass if direction includes reclass updates
    if (direction !== 'reclass-to-yaml') {
      const reclassResult = reclassExporter.export(
        result.merged.structs || [],
        result.merged.enums || [],
        { includeComments: true }
      );
      const reclassOutputPath = direction === 'yaml-to-reclass'
        ? options.reclass
        : options.reclass.replace(/\.reclass$/, '.synced.reclass');

      fs.writeFileSync(reclassOutputPath, reclassResult.content);
      console.log(chalk.green(`✓ ReClass written to: ${reclassOutputPath}`));
    }
  }
}

/**
 * Parse direction string to SyncDirection
 */
function parseDirection(dir: string): SyncDirection {
  const normalized = dir.toLowerCase().replace(/[_\s]/g, '-');

  switch (normalized) {
    case 'yaml-to-reclass':
    case 'yaml':
      return 'yaml-to-reclass';
    case 'reclass-to-yaml':
    case 'reclass':
      return 'reclass-to-yaml';
    case 'bidirectional':
    case 'both':
    case 'bi':
      return 'bidirectional';
    default:
      console.warn(chalk.yellow(`Unknown direction '${dir}', using 'bidirectional'`));
      return 'bidirectional';
  }
}

/**
 * Parse conflict strategy string
 */
function parseConflictStrategy(strategy: string): ConflictStrategy {
  const normalized = strategy.toLowerCase().replace(/[_\s]/g, '-');

  switch (normalized) {
    case 'prefer-yaml':
    case 'yaml':
      return 'prefer-yaml';
    case 'prefer-reclass':
    case 'reclass':
      return 'prefer-reclass';
    case 'manual':
      return 'manual';
    case 'newest':
      return 'newest';
    default:
      console.warn(chalk.yellow(`Unknown conflict strategy '${strategy}', using 'prefer-yaml'`));
      return 'prefer-yaml';
  }
}

/**
 * Print sync summary to console
 */
function printSyncSummary(result: SyncResult): void {
  console.log(chalk.blue('───────────────────────────────────────────────────────────────'));
  console.log(chalk.blue('Sync Summary'));
  console.log(chalk.blue('───────────────────────────────────────────────────────────────\n'));

  console.log(`Direction:          ${result.direction}`);
  console.log(`Structs analyzed:   ${result.structsAnalyzed}`);

  if (result.structsAdded > 0) {
    console.log(chalk.green(`  Added:            ${result.structsAdded}`));
  }
  if (result.structsRemoved > 0) {
    console.log(chalk.red(`  Removed:          ${result.structsRemoved}`));
  }
  if (result.structsChanged > 0) {
    console.log(chalk.yellow(`  Modified:         ${result.structsChanged}`));
  }

  console.log();
  console.log(`Fields changed:`);
  if (result.fieldsAdded > 0) {
    console.log(chalk.green(`  Added:            ${result.fieldsAdded}`));
  }
  if (result.fieldsRemoved > 0) {
    console.log(chalk.red(`  Removed:          ${result.fieldsRemoved}`));
  }
  if (result.fieldsModified > 0) {
    console.log(chalk.yellow(`  Modified:         ${result.fieldsModified}`));
  }

  if (result.conflictCount > 0) {
    console.log();
    console.log(chalk.red(`Conflicts:          ${result.conflictCount}`));
    console.log(chalk.red(`  Unresolved:       ${result.unresolvedConflicts.length}`));
  }

  // Show detailed changes
  if (result.structsChanged > 0 || result.structsAdded > 0 || result.structsRemoved > 0) {
    console.log(chalk.blue('\n───────────────────────────────────────────────────────────────'));
    console.log(chalk.blue('Changes'));
    console.log(chalk.blue('───────────────────────────────────────────────────────────────\n'));

    for (const change of result.changes) {
      if (change.changeType === 'unchanged') continue;

      const icon = change.changeType === 'added' ? chalk.green('+') :
                   change.changeType === 'removed' ? chalk.red('-') :
                   chalk.yellow('~');

      console.log(`${icon} ${change.structName}`);

      if (change.sizeChanged) {
        console.log(chalk.gray(`    Size: ${toHex(change.oldSize || 0)} → ${toHex(change.newSize || 0)}`));
      }

      // Show field changes (limit to first 10 per struct)
      let shownFields = 0;
      for (const fieldChange of change.fieldChanges) {
        if (fieldChange.changeType === 'unchanged') continue;
        if (shownFields >= 10) {
          const remaining = change.fieldChanges.filter(f => f.changeType !== 'unchanged').length - 10;
          if (remaining > 0) {
            console.log(chalk.gray(`    ... and ${remaining} more field(s)`));
          }
          break;
        }

        const fieldIcon = fieldChange.changeType === 'added' ? chalk.green('+') :
                          fieldChange.changeType === 'removed' ? chalk.red('-') :
                          chalk.yellow('~');
        const conflictMark = fieldChange.conflict ? chalk.red(' [CONFLICT]') : '';
        const offsetStr = toHex(fieldChange.offset);

        if (fieldChange.changeType === 'added') {
          const field = fieldChange.reclassField!;
          console.log(`    ${fieldIcon} ${offsetStr}: ${field.name || '(unnamed)'} (${field.type})${conflictMark}`);
        } else if (fieldChange.changeType === 'removed') {
          const field = fieldChange.yamlField!;
          console.log(`    ${fieldIcon} ${offsetStr}: ${field.name || '(unnamed)'} (${field.type})${conflictMark}`);
        } else {
          const oldField = fieldChange.yamlField!;
          const newField = fieldChange.reclassField!;
          console.log(`    ${fieldIcon} ${offsetStr}: ${oldField.name || '(unnamed)'} → ${newField.name || '(unnamed)'}${conflictMark}`);
        }

        shownFields++;
      }

      console.log();
    }
  }
}

// ============================================================================
// Command Registration
// ============================================================================

export function createSyncCommand(): Command {
  const cmd = new Command('sync')
    .description('Bidirectional synchronization between YAML and ReClass.NET')
    .argument('<yaml-patterns...>', 'YAML file paths or glob patterns')
    .requiredOption('-r, --reclass <file>', 'ReClass.NET file to sync with')
    .option('-d, --direction <dir>', 'Sync direction: yaml-to-reclass, reclass-to-yaml, bidirectional', 'bidirectional')
    .option('-c, --conflict <strategy>', 'Conflict strategy: prefer-yaml, prefer-reclass, manual', 'prefer-yaml')
    .option('-o, --output <path>', 'Output path for merged YAML')
    .option('--dry-run', 'Preview changes without writing files')
    .option('--json', 'Output as JSON')
    .option('--min-confidence <n>', 'Minimum confidence for auto-accepting changes', '70')
    .option('--no-preserve-names', 'Allow ReClass to override YAML field names')
    .option('--no-preserve-types', 'Allow ReClass to override YAML field types')
    .action(async (yamlPatterns: string[], options: SyncCommandOptions) => {
      await runSync(yamlPatterns, options);
    });

  return cmd;
}
