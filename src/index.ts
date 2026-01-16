#!/usr/bin/env node

/**
 * ffxiv-struct-tools CLI
 *
 * Tools for FFXIVClientStructs maintainers
 */

import { program } from 'commander';
import { runValidate, type ValidateOptions } from './commands/validate.js';
import { runDiff, type DiffOptions } from './commands/diff.js';
import { runPatch, type PatchOptions } from './commands/patch.js';
import { runExport, type ExportCommandOptions } from './commands/export.js';
import { createTestCommand } from './commands/test.js';
import { createCompareReportCommand } from './commands/compare-report.js';
import { createReportCommand } from './commands/report.js';
import {
  runVersionSave,
  runVersionList,
  runVersionDiff,
  runVersionHistory,
  runVersionDelete,
  type VersionOptions,
} from './commands/version.js';
import {
  runVTablesExtract,
  runVTablesDiff,
  type VTablesOptions,
} from './commands/vtables.js';
import { createSigCommand } from './commands/sig.js';
import { createDiscoverCommand } from './commands/discover.js';
import { createImportCommand } from './commands/import.js';

program
  .name('fst')
  .description('CLI tools for FFXIVClientStructs maintainers')
  .version('0.1.0');

// validate command
program
  .command('validate')
  .description('Run sanity checks on YAML struct definitions')
  .argument('<patterns...>', 'YAML file paths or glob patterns')
  .option('-s, --strict', 'Enable strict mode with additional checks')
  .option(
    '-i, --ignore <rules...>',
    'Ignore specific validation rules (comma-separated)'
  )
  .option('--json', 'Output results as JSON')
  .option('--summary', 'Show summary for all files, even those with no issues')
  .action(async (patterns: string[], options: ValidateOptions) => {
    await runValidate(patterns, options);
  });

// diff command
program
  .command('diff')
  .description('Compare struct definitions between versions')
  .argument('<old>', 'Old version file(s) or glob pattern')
  .argument('<new>', 'New version file(s) or glob pattern')
  .option('-p, --detect-patterns', 'Detect and report bulk offset shift patterns')
  .option('--json', 'Output results as JSON')
  .option('--summary', 'Show summary only')
  .option('--structs-only', 'Only show struct changes')
  .option('--enums-only', 'Only show enum changes')
  .action(async (oldPattern: string, newPattern: string, options: DiffOptions) => {
    await runDiff(oldPattern, newPattern, options);
  });

// patch command
program
  .command('patch')
  .description('Generate and apply offset patches to YAML files')
  .argument('[patterns...]', 'YAML file paths or glob patterns to patch')
  .option('-s, --struct <pattern>', 'Struct name pattern to patch (supports * wildcard)')
  .option('-d, --delta <offset>', 'Offset delta to apply (e.g., 0x8 or +8)')
  .option('--vfunc-delta <n>', 'VFunc slot delta to apply')
  .option('--start-offset <offset>', 'Starting offset for shifts (default: 0)')
  .option('--start-slot <n>', 'Starting vfunc slot for shifts (default: 0)')
  .option('--dry-run', 'Show what would be changed without writing files')
  .option('--apply <file>', 'Apply a patch file instead of CLI options')
  .option('-o, --output <path>', 'Output path (default: overwrite input)')
  .option('--json', 'Output results as JSON')
  // Auto-detect options
  .option('--auto-detect', 'Auto-detect offset deltas between two versions')
  .option('--old <path>', 'Old version directory/pattern (for --auto-detect)')
  .option('--new <path>', 'New version directory/pattern (for --auto-detect)')
  .option('--manifest <file>', 'Apply patches from a manifest file')
  .option('--min-confidence <n>', 'Minimum confidence threshold (0-1) for manifest patches')
  .option('--preview', 'Show detailed preview of detected patterns')
  .action(async (patterns: string[], options: PatchOptions) => {
    await runPatch(patterns, options);
  });

// vtables command (with subcommands)
const vtablesCmd = program
  .command('vtables')
  .description('Track vtable addresses and slot changes across versions');

vtablesCmd
  .command('extract')
  .description('Extract vtable information from YAML files')
  .argument('<patterns...>', 'YAML file paths or glob patterns')
  .option('-o, --output <path>', 'Output file path')
  .option('-v, --version <version>', 'Version identifier')
  .option('-f, --format <type>', 'Output format: json, ida, ghidra')
  .option('--json', 'Output as JSON (same as --format json)')
  .action(async (patterns: string[], options: VTablesOptions) => {
    await runVTablesExtract(patterns, options);
  });

vtablesCmd
  .command('diff')
  .description('Compare vtables between two versions')
  .argument('<old>', 'Old version (JSON file or YAML directory)')
  .argument('<new>', 'New version (JSON file or YAML directory)')
  .option('--json', 'Output as JSON')
  .action(async (oldPath: string, newPath: string, options: VTablesOptions) => {
    await runVTablesDiff(oldPath, newPath, options);
  });

// export command
program
  .command('export')
  .description('Export definitions to other formats (IDA, ReClass, C headers, Ghidra)')
  .argument('<patterns...>', 'YAML file paths or glob patterns')
  .requiredOption('-f, --format <type>', 'Output format: ida, reclass, headers, ghidra')
  .option('-o, --output <path>', 'Output file path')
  .option('-n, --namespace <name>', 'Namespace/category for generated types (default: FFXIV)')
  .option('-c, --comments', 'Include comments/documentation in output')
  .action(async (patterns: string[], options: ExportCommandOptions) => {
    await runExport(patterns, options);
  });

// version command (with subcommands)
const versionCmd = program
  .command('version')
  .description('Track struct evolution across game versions');

versionCmd
  .command('save')
  .description('Save a new version snapshot')
  .argument('<version>', 'Version identifier (e.g., "7.0", "6.5")')
  .option('-p, --path <path>', 'Path to YAML files (default: current directory)')
  .option('-n, --notes <text>', 'Notes about this version')
  .option('-g, --game-version <version>', 'Game patch version')
  .option('--json', 'Output as JSON')
  .action(async (version: string, options: VersionOptions) => {
    await runVersionSave(version, options);
  });

versionCmd
  .command('list')
  .description('List all saved versions')
  .option('--json', 'Output as JSON')
  .action(async (options: VersionOptions) => {
    await runVersionList(options);
  });

versionCmd
  .command('diff')
  .description('Show changes between two versions')
  .argument('<from>', 'Source version')
  .argument('<to>', 'Target version')
  .option('--json', 'Output as JSON')
  .action(async (from: string, to: string, options: VersionOptions) => {
    await runVersionDiff(from, to, options);
  });

versionCmd
  .command('history')
  .description('Show history for a specific struct')
  .argument('<struct>', 'Struct name to look up')
  .option('--json', 'Output as JSON')
  .action(async (struct: string, options: VersionOptions) => {
    await runVersionHistory(struct, options);
  });

versionCmd
  .command('delete')
  .description('Delete a saved version')
  .argument('<version>', 'Version to delete')
  .option('-f, --force', 'Confirm deletion')
  .action(async (version: string, options: VersionOptions) => {
    await runVersionDelete(version, options);
  });

// test command
program.addCommand(createTestCommand());

// compare-report command
program.addCommand(createCompareReportCommand());

// report command
program.addCommand(createReportCommand());

// sig command
program.addCommand(createSigCommand());

// discover command
program.addCommand(createDiscoverCommand());

// import command
program.addCommand(createImportCommand());

program.parse();
