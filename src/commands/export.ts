/**
 * export command - Export definitions to various formats
 */

import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join, basename } from 'node:path';
import { glob } from 'glob';
import chalk from 'chalk';
import { parseYamlFile, type ParsedFile } from '../lib/yaml-parser.js';
import {
  getExporter,
  getAvailableFormats,
  type ExportFormat,
  type ExportOptions,
} from '../lib/exporters/index.js';

export interface ExportCommandOptions {
  format: string;
  output?: string;
  namespace?: string;
  comments?: boolean;
}

/**
 * Run the export command
 */
export async function runExport(
  patterns: string[],
  options: ExportCommandOptions
): Promise<void> {
  // Validate format
  const format = options.format.toLowerCase() as ExportFormat;
  const availableFormats = getAvailableFormats();

  if (!availableFormats.includes(format)) {
    console.error(chalk.red(`Unknown format: ${options.format}`));
    console.log(chalk.gray(`Available formats: ${availableFormats.join(', ')}`));
    process.exit(1);
  }

  const exporter = getExporter(format);
  if (!exporter) {
    console.error(chalk.red(`Exporter not found for format: ${format}`));
    process.exit(1);
  }

  // Expand glob patterns
  const filePaths: string[] = [];
  for (const pattern of patterns) {
    const matches = await glob(pattern, { nodir: true });
    filePaths.push(...matches);
  }

  if (filePaths.length === 0) {
    console.error(chalk.red('No files found matching the provided patterns'));
    process.exit(1);
  }

  console.log(chalk.blue(`Exporting ${filePaths.length} file(s) to ${format} format...\n`));

  // Parse all files
  const parsedFiles: ParsedFile[] = [];
  for (const filePath of filePaths) {
    try {
      const parsed = parseYamlFile(filePath);
      parsedFiles.push(parsed);
    } catch (error) {
      console.error(chalk.red(`Failed to parse ${filePath}:`), error);
      process.exit(1);
    }
  }

  // Aggregate all structs and enums
  const allStructs = parsedFiles.flatMap(f => f.structs);
  const allEnums = parsedFiles.flatMap(f => f.enums);

  console.log(chalk.gray(`Found ${allStructs.length} structs and ${allEnums.length} enums`));
  console.log();

  // Export
  const exportOptions: ExportOptions = {
    output: options.output,
    namespace: options.namespace,
    includeComments: options.comments,
    arch: 'x64',
  };

  const result = exporter.export(allStructs, allEnums, exportOptions);

  // Determine output path
  let outputPath: string;
  if (options.output) {
    outputPath = options.output;
  } else {
    // Generate default output filename
    const inputBasename = filePaths.length === 1
      ? basename(filePaths[0], '.yaml').replace('.yml', '')
      : 'ffxiv_structs';
    outputPath = `${inputBasename}${exporter.extension}`;
  }

  // Ensure output directory exists
  const outputDir = dirname(outputPath);
  if (outputDir && outputDir !== '.' && !existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }

  // Write output
  try {
    writeFileSync(outputPath, result.content, 'utf-8');
    console.log(chalk.green(`✓ Exported to ${outputPath}`));
    console.log();
    console.log(chalk.blue('Export Summary'));
    console.log(chalk.blue('─────────────────'));
    console.log(`Format:    ${format}`);
    console.log(`Structs:   ${result.structCount}`);
    console.log(`Enums:     ${result.enumCount}`);
    console.log(`Output:    ${outputPath}`);

    if (result.warnings.length > 0) {
      console.log();
      console.log(chalk.yellow('Warnings:'));
      for (const warning of result.warnings) {
        console.log(chalk.yellow(`  ⚠ ${warning}`));
      }
    }
  } catch (error) {
    console.error(chalk.red(`Failed to write ${outputPath}:`), error);
    process.exit(1);
  }
}
