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
  .argument('<patterns...>', 'YAML file paths or glob patterns to patch')
  .option('-s, --struct <pattern>', 'Struct name pattern to patch (supports * wildcard)')
  .option('-d, --delta <offset>', 'Offset delta to apply (e.g., 0x8 or +8)')
  .option('--vfunc-delta <n>', 'VFunc slot delta to apply')
  .option('--start-offset <offset>', 'Starting offset for shifts (default: 0)')
  .option('--start-slot <n>', 'Starting vfunc slot for shifts (default: 0)')
  .option('--dry-run', 'Show what would be changed without writing files')
  .option('--apply <file>', 'Apply a patch file instead of CLI options')
  .option('-o, --output <path>', 'Output path (default: overwrite input)')
  .option('--json', 'Output patch file as JSON')
  .action(async (patterns: string[], options: PatchOptions) => {
    await runPatch(patterns, options);
  });

// Placeholder commands for future implementation

program
  .command('vtables')
  .description('Track vtable addresses across versions (coming soon)')
  .option('--binary <path>', 'Binary file to scan')
  .option('--output <path>', 'Output JSON file')
  .option('--diff <files...>', 'Compare two vtable JSON files')
  .action(() => {
    console.log('vtables command not yet implemented');
    process.exit(0);
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

// test command
program.addCommand(createTestCommand());

// compare-report command
program.addCommand(createCompareReportCommand());

// report command
program.addCommand(createReportCommand());

program.parse();
