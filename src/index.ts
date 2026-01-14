#!/usr/bin/env node

/**
 * ffxiv-struct-tools CLI
 *
 * Tools for FFXIVClientStructs maintainers
 */

import { program } from 'commander';
import { runValidate, type ValidateOptions } from './commands/validate.js';

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

// Placeholder commands for future implementation
program
  .command('diff')
  .description('Compare struct definitions between versions (coming soon)')
  .argument('<old>', 'Old version file or directory')
  .argument('<new>', 'New version file or directory')
  .option('--detect-patterns', 'Detect bulk offset shift patterns')
  .action(() => {
    console.log('diff command not yet implemented');
    process.exit(0);
  });

program
  .command('patch')
  .description('Generate and apply offset patches (coming soon)')
  .option('--struct <pattern>', 'Struct name pattern to patch')
  .option('--delta <offset>', 'Offset delta to apply (e.g., +0x8)')
  .option('--dry-run', 'Show what would be changed without applying')
  .option('--apply <files...>', 'Apply patch files')
  .action(() => {
    console.log('patch command not yet implemented');
    process.exit(0);
  });

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

program
  .command('export')
  .description('Export definitions to other formats (coming soon)')
  .option('--format <type>', 'Output format: ida, reclass, header')
  .option('--output <path>', 'Output file path')
  .action(() => {
    console.log('export command not yet implemented');
    process.exit(0);
  });

program.parse();
