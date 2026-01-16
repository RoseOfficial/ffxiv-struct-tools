/**
 * Import command - Import struct definitions from other formats
 */

import { Command } from 'commander';
import fs from 'fs/promises';
import path from 'path';
import chalk from 'chalk';
import yaml from 'js-yaml';
import {
  importReclass,
  SUPPORTED_IMPORT_FORMATS,
  type ImportFormat,
} from '../lib/importers/index.js';
import type { YamlData } from '../lib/types.js';

export interface ImportCommandOptions {
  output?: string;
  merge?: string;
  dryRun?: boolean;
  prefix?: string;
  comments?: boolean;
  json?: boolean;
}

export function createImportCommand(): Command {
  const cmd = new Command('import');

  cmd
    .description('Import struct definitions from other formats')
    .argument('<format>', `Import format: ${SUPPORTED_IMPORT_FORMATS.join(', ')}`)
    .argument('<input>', 'Input file path')
    .option('-o, --output <path>', 'Output YAML file path')
    .option('-m, --merge <path>', 'Merge with existing YAML file')
    .option('--dry-run', 'Show what would be imported without writing')
    .option('-p, --prefix <prefix>', 'Prefix to add to struct names')
    .option('-c, --comments', 'Include comments from source')
    .option('--json', 'Output results as JSON')
    .action(async (format: string, input: string, options: ImportCommandOptions) => {
      try {
        await runImport(format as ImportFormat, input, options);
      } catch (error) {
        if (options.json) {
          console.log(JSON.stringify({ error: (error as Error).message }, null, 2));
        } else {
          console.error(chalk.red('Error:'), (error as Error).message);
        }
        process.exit(1);
      }
    });

  return cmd;
}

async function runImport(
  format: ImportFormat,
  inputPath: string,
  options: ImportCommandOptions
): Promise<void> {
  // Validate format
  if (!SUPPORTED_IMPORT_FORMATS.includes(format)) {
    throw new Error(
      `Unsupported format '${format}'. Supported formats: ${SUPPORTED_IMPORT_FORMATS.join(', ')}`
    );
  }

  // Read input file
  const inputContent = await fs.readFile(inputPath, 'utf-8');

  // Load merge file if specified
  let mergeData: YamlData | undefined;
  if (options.merge) {
    const mergeContent = await fs.readFile(options.merge, 'utf-8');
    mergeData = yaml.load(mergeContent) as YamlData;
  }

  // Import based on format
  let result;
  switch (format) {
    case 'reclass':
      result = importReclass(inputContent, {
        prefix: options.prefix,
        includeComments: options.comments,
        mergeWith: mergeData,
      });
      break;
    default:
      throw new Error(`Format '${format}' not implemented`);
  }

  // Generate output
  const outputYaml = yaml.dump(result.data, {
    indent: 2,
    lineWidth: 120,
    noRefs: true,
    sortKeys: false,
  });

  // Output results
  if (options.json) {
    console.log(JSON.stringify({
      structCount: result.structCount,
      enumCount: result.enumCount,
      warnings: result.warnings,
      ...(options.dryRun ? { preview: result.data } : {}),
    }, null, 2));
  } else {
    console.log(chalk.cyan('Import Summary:'));
    console.log(`  Structs: ${result.structCount}`);
    console.log(`  Enums:   ${result.enumCount}`);

    if (result.warnings.length > 0) {
      console.log(chalk.yellow('\nWarnings:'));
      for (const warning of result.warnings) {
        console.log(`  ⚠ ${warning}`);
      }
    }

    if (options.dryRun) {
      console.log(chalk.yellow('\n--- Dry Run Preview ---\n'));
      console.log(outputYaml);
    }
  }

  // Write output if not dry-run
  if (!options.dryRun) {
    const outputPath = options.output || inputPath.replace(/\.[^.]+$/, '.yaml');

    await fs.writeFile(outputPath, outputYaml, 'utf-8');

    if (!options.json) {
      console.log(chalk.green(`\n✓ Written to: ${outputPath}`));
    }
  }
}

export default createImportCommand;
