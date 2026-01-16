/**
 * watch command - Monitor YAML files and auto-validate/export on change
 * Supports ReClass.NET sync for bidirectional workflows
 */

import { glob } from 'glob';
import chalk from 'chalk';
import { parseYamlFile, getAllStructNames, getAllEnumNames, type ParsedFile } from '../lib/yaml-parser.js';
import { validateStruct, validateEnum } from '../lib/validators.js';
import { getExporter, getAvailableFormats, type ExportFormat, type ExportOptions } from '../lib/exporters/index.js';
import { createYamlWatcher, type WatchEvent } from '../lib/watcher.js';
import type { ValidationIssue, ValidationOptions, YamlData } from '../lib/types.js';
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { dirname, basename } from 'node:path';
import { importReclass } from '../lib/importers/reclass.js';
import { reclassExporter } from '../lib/exporters/reclass.js';
import { syncData, generateDiffSummary, type SyncDirection, type ConflictStrategy } from '../lib/sync-engine.js';
import { serializeYaml } from '../lib/yaml-serializer.js';

export interface WatchOptions {
  export?: string;
  validate?: boolean;
  debounce?: number;
  output?: string;
  namespace?: string;
  strict?: boolean;
  ignore?: string[];
  // ReClass sync options
  syncReclass?: string;
  syncDirection?: string;
}

/**
 * Run the watch command
 */
export async function runWatch(
  patterns: string[],
  options: WatchOptions
): Promise<void> {
  // Validate export format if specified
  if (options.export) {
    const format = options.export.toLowerCase();
    const availableFormats = getAvailableFormats();
    if (!availableFormats.includes(format as ExportFormat)) {
      console.error(chalk.red(`Unknown export format: ${options.export}`));
      console.log(chalk.gray(`Available formats: ${availableFormats.join(', ')}`));
      process.exit(1);
    }
  }

  // Expand patterns to verify files exist
  const initialFiles: string[] = [];
  for (const pattern of patterns) {
    const matches = await glob(pattern, { nodir: true });
    initialFiles.push(...matches);
  }

  if (initialFiles.length === 0) {
    console.error(chalk.red('No files found matching the provided patterns'));
    process.exit(1);
  }

  // Validate ReClass sync options
  if (options.syncReclass && !existsSync(options.syncReclass)) {
    console.error(chalk.red(`ReClass file not found: ${options.syncReclass}`));
    process.exit(1);
  }

  const syncDirection = parseSyncDirection(options.syncDirection || 'bidirectional');

  console.log(chalk.blue('Watch Mode'));
  console.log(chalk.blue('──────────────────────────────────────'));
  console.log(`Watching:   ${patterns.join(', ')}`);
  console.log(`Files:      ${initialFiles.length} YAML files`);
  console.log(`Validate:   ${options.validate !== false ? 'yes' : 'no'}`);
  console.log(`Export:     ${options.export || 'none'}`);
  if (options.syncReclass) {
    console.log(`Sync:       ${options.syncReclass} (${syncDirection})`);
  }
  console.log(`Debounce:   ${options.debounce || 500}ms`);
  console.log();
  console.log(chalk.gray('Press Ctrl+C to stop watching'));
  console.log();

  // Create watcher
  const watcher = createYamlWatcher({
    debounce: options.debounce || 500,
    runOnReady: true,
  });

  // Track stats
  let processCount = 0;
  let errorCount = 0;

  watcher.on('changes', async (changes: WatchEvent[]) => {
    const timestamp = new Date().toLocaleTimeString();
    const changedPaths = changes
      .filter(c => c.type !== 'unlink')
      .map(c => c.path);
    const removedPaths = changes
      .filter(c => c.type === 'unlink')
      .map(c => c.path);

    if (removedPaths.length > 0) {
      console.log(chalk.gray(`[${timestamp}] Removed: ${removedPaths.length} file(s)`));
    }

    if (changedPaths.length === 0) {
      // Only deletions, re-expand patterns to get current files
      const currentFiles: string[] = [];
      for (const pattern of patterns) {
        const matches = await glob(pattern, { nodir: true });
        currentFiles.push(...matches);
      }
      if (currentFiles.length === 0) {
        console.log(chalk.yellow(`[${timestamp}] No YAML files remaining`));
        return;
      }
    }

    processCount++;
    console.log(chalk.cyan(`[${timestamp}] Processing ${changedPaths.length || 'all'} changed file(s)...`));

    try {
      // Re-expand patterns to get all current files (for context)
      const allFiles: string[] = [];
      for (const pattern of patterns) {
        const matches = await glob(pattern, { nodir: true });
        allFiles.push(...matches);
      }

      if (allFiles.length === 0) {
        console.log(chalk.yellow(`  No files to process`));
        return;
      }

      // Parse all files for context
      const parsedFiles: ParsedFile[] = [];
      for (const filePath of allFiles) {
        try {
          const parsed = parseYamlFile(filePath);
          parsedFiles.push(parsed);
        } catch (error) {
          console.error(chalk.red(`  Failed to parse ${filePath}:`), error);
          errorCount++;
          return;
        }
      }

      // Run validation if enabled
      if (options.validate !== false) {
        const validationResult = runValidation(parsedFiles, options);
        if (validationResult.errors > 0) {
          console.log(chalk.red(`  ✗ ${validationResult.errors} error(s), ${validationResult.warnings} warning(s)`));
          errorCount += validationResult.errors;
        } else if (validationResult.warnings > 0) {
          console.log(chalk.yellow(`  ⚠ ${validationResult.warnings} warning(s)`));
        } else {
          console.log(chalk.green(`  ✓ Validation passed`));
        }
      }

      // Run export if enabled
      if (options.export) {
        const exportResult = runExport(parsedFiles, options);
        if (exportResult.success) {
          console.log(chalk.green(`  ✓ Exported to ${exportResult.outputPath}`));
        } else {
          console.log(chalk.red(`  ✗ Export failed: ${exportResult.error}`));
          errorCount++;
        }
      }

      // Run ReClass sync if enabled
      if (options.syncReclass) {
        const syncResult = runReclassSync(parsedFiles, options, syncDirection);
        if (syncResult.success) {
          if (syncResult.changes > 0) {
            console.log(chalk.green(`  ✓ Synced with ReClass (${syncResult.changes} changes)`));
          } else {
            console.log(chalk.gray(`  ✓ ReClass in sync`));
          }
        } else {
          console.log(chalk.red(`  ✗ Sync failed: ${syncResult.error}`));
          errorCount++;
        }
      }

    } catch (error) {
      console.error(chalk.red(`  Unexpected error:`), error);
      errorCount++;
    }
  });

  watcher.on('error', (error) => {
    console.error(chalk.red('Watcher error:'), error);
  });

  // Handle graceful shutdown
  process.on('SIGINT', async () => {
    console.log();
    console.log(chalk.blue('Stopping watch mode...'));
    await watcher.stop();
    console.log();
    console.log(chalk.blue('Summary'));
    console.log(chalk.blue('──────────────────────────────────────'));
    console.log(`Processed:  ${processCount} change event(s)`);
    console.log(`Errors:     ${errorCount}`);
    process.exit(0);
  });

  // Start watching
  await watcher.start(patterns);
}

interface ValidationSummary {
  errors: number;
  warnings: number;
  issues: ValidationIssue[];
}

function runValidation(parsedFiles: ParsedFile[], options: WatchOptions): ValidationSummary {
  const allStructNames = getAllStructNames(parsedFiles);
  const allEnumNames = getAllEnumNames(parsedFiles);
  const validationOptions: ValidationOptions = {
    strict: options.strict,
    ignoreRules: options.ignore,
  };

  const context = {
    allStructNames,
    allEnumNames,
    options: validationOptions,
  };

  const allIssues: ValidationIssue[] = [];

  for (const parsed of parsedFiles) {
    for (const struct of parsed.structs) {
      const issues = validateStruct(struct, context);
      allIssues.push(...issues);
    }
    for (const enumDef of parsed.enums) {
      const issues = validateEnum(enumDef, context);
      allIssues.push(...issues);
    }
  }

  return {
    errors: allIssues.filter(i => i.severity === 'error').length,
    warnings: allIssues.filter(i => i.severity === 'warning').length,
    issues: allIssues,
  };
}

interface ExportSummary {
  success: boolean;
  outputPath?: string;
  error?: string;
}

function runExport(parsedFiles: ParsedFile[], options: WatchOptions): ExportSummary {
  if (!options.export) {
    return { success: false, error: 'No export format specified' };
  }

  const format = options.export.toLowerCase() as ExportFormat;
  const exporter = getExporter(format);

  if (!exporter) {
    return { success: false, error: `Exporter not found for format: ${format}` };
  }

  const allStructs = parsedFiles.flatMap(f => f.structs);
  const allEnums = parsedFiles.flatMap(f => f.enums);

  const exportOptions: ExportOptions = {
    output: options.output,
    namespace: options.namespace,
    includeComments: true,
    arch: 'x64',
  };

  try {
    const result = exporter.export(allStructs, allEnums, exportOptions);

    // Determine output path
    let outputPath: string;
    if (options.output) {
      outputPath = options.output;
    } else {
      outputPath = `ffxiv_structs${exporter.extension}`;
    }

    // Ensure output directory exists
    const outputDir = dirname(outputPath);
    if (outputDir && outputDir !== '.' && !existsSync(outputDir)) {
      mkdirSync(outputDir, { recursive: true });
    }

    writeFileSync(outputPath, result.content, 'utf-8');

    return { success: true, outputPath };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

function parseSyncDirection(dir: string): SyncDirection {
  const normalized = dir.toLowerCase().replace(/[_\s]/g, '-');

  switch (normalized) {
    case 'yaml-to-reclass':
    case 'yaml':
    case 'yaml-only':
      return 'yaml-to-reclass';
    case 'reclass-to-yaml':
    case 'reclass':
    case 'reclass-only':
      return 'reclass-to-yaml';
    case 'bidirectional':
    case 'both':
    case 'bi':
      return 'bidirectional';
    default:
      return 'bidirectional';
  }
}

interface SyncSummary {
  success: boolean;
  changes: number;
  error?: string;
}

function runReclassSync(
  parsedFiles: ParsedFile[],
  options: WatchOptions,
  direction: SyncDirection
): SyncSummary {
  if (!options.syncReclass) {
    return { success: false, changes: 0, error: 'No ReClass file specified' };
  }

  try {
    // Build YAML data from parsed files
    const yamlData: YamlData = {
      structs: parsedFiles.flatMap(f => f.structs),
      enums: parsedFiles.flatMap(f => f.enums),
    };

    // Load ReClass file
    const reclassContent = readFileSync(options.syncReclass, 'utf-8');
    const importResult = importReclass(reclassContent);
    const reclassData = importResult.data;

    // Run sync
    const result = syncData(yamlData, reclassData, {
      direction,
      conflictStrategy: 'prefer-yaml',
      preserveNames: true,
      preserveTypes: true,
      preserveNotes: true,
    });

    // Check if there are any changes
    const totalChanges = result.fieldsAdded + result.fieldsRemoved + result.fieldsModified +
                         result.structsAdded + result.structsRemoved;

    if (totalChanges === 0) {
      return { success: true, changes: 0 };
    }

    // Check for unresolved conflicts
    if (result.unresolvedConflicts.length > 0) {
      return {
        success: false,
        changes: totalChanges,
        error: `${result.unresolvedConflicts.length} unresolved conflicts`,
      };
    }

    // Write merged results if available
    if (result.merged) {
      // Write updated YAML if direction allows
      if (direction !== 'yaml-to-reclass' && options.output) {
        const yamlContent = serializeYaml(result.merged);
        writeFileSync(options.output, yamlContent);
      }

      // Write updated ReClass if direction allows
      if (direction !== 'reclass-to-yaml') {
        const reclassResult = reclassExporter.export(
          result.merged.structs || [],
          result.merged.enums || [],
          { includeComments: true }
        );
        writeFileSync(options.syncReclass, reclassResult.content);
      }
    }

    return { success: true, changes: totalChanges };
  } catch (error) {
    return { success: false, changes: 0, error: String(error) };
  }
}
