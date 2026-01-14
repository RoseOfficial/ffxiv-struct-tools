/**
 * validate command - Run sanity checks on YAML struct definitions
 */

import { glob } from 'glob';
import chalk from 'chalk';
import type { ValidationResult, ValidationOptions, ValidationIssue } from '../lib/types.js';
import {
  parseYamlFile,
  getAllStructNames,
  getAllEnumNames,
  type ParsedFile,
} from '../lib/yaml-parser.js';
import { validateStruct, validateEnum } from '../lib/validators.js';

export interface ValidateOptions {
  strict?: boolean;
  ignore?: string[];
  json?: boolean;
  summary?: boolean;
}

/**
 * Run validation on files matching the given pattern
 */
export async function runValidate(
  patterns: string[],
  options: ValidateOptions
): Promise<void> {
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

  console.log(chalk.blue(`Validating ${filePaths.length} file(s)...\n`));

  // Parse all files first to build type registry
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

  // Build context with all known types
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

  // Validate each file
  const results: ValidationResult[] = [];
  let totalErrors = 0;
  let totalWarnings = 0;

  for (const parsed of parsedFiles) {
    const issues: ValidationIssue[] = [];

    // Validate structs
    for (const struct of parsed.structs) {
      const structIssues = validateStruct(struct, context);
      issues.push(...structIssues);
    }

    // Validate enums
    for (const enumDef of parsed.enums) {
      const enumIssues = validateEnum(enumDef, context);
      issues.push(...enumIssues);
    }

    const errors = issues.filter((i) => i.severity === 'error').length;
    const warnings = issues.filter((i) => i.severity === 'warning').length;

    results.push({
      file: parsed.path,
      issues,
      stats: {
        structs: parsed.structs.length,
        enums: parsed.enums.length,
        errors,
        warnings,
      },
    });

    totalErrors += errors;
    totalWarnings += warnings;
  }

  // Output results
  if (options.json) {
    console.log(JSON.stringify(results, null, 2));
    return;
  }

  // Print issues grouped by file
  for (const result of results) {
    if (result.issues.length === 0 && !options.summary) continue;

    console.log(chalk.cyan(`\n${result.file}`));
    console.log(
      chalk.gray(
        `  ${result.stats.structs} structs, ${result.stats.enums} enums`
      )
    );

    if (result.issues.length === 0) {
      console.log(chalk.green('  ✓ No issues found'));
      continue;
    }

    // Group issues by struct
    const issuesByStruct = new Map<string, ValidationIssue[]>();
    for (const issue of result.issues) {
      const key = issue.struct || '<global>';
      if (!issuesByStruct.has(key)) {
        issuesByStruct.set(key, []);
      }
      issuesByStruct.get(key)!.push(issue);
    }

    for (const [structName, structIssues] of issuesByStruct) {
      console.log(chalk.white(`  ${structName}:`));
      for (const issue of structIssues) {
        const icon = getIcon(issue.severity);
        const color = getColor(issue.severity);
        const fieldInfo = issue.field ? ` [${issue.field}]` : '';
        console.log(color(`    ${icon} ${issue.message}${fieldInfo}`));
      }
    }
  }

  // Print summary
  console.log(chalk.blue('\n───────────────────────────────────'));
  console.log(chalk.blue('Summary'));
  console.log(chalk.blue('───────────────────────────────────'));

  const totalStructs = results.reduce((sum, r) => sum + r.stats.structs, 0);
  const totalEnums = results.reduce((sum, r) => sum + r.stats.enums, 0);
  const totalInfos = results.reduce(
    (sum, r) => sum + r.issues.filter((i) => i.severity === 'info').length,
    0
  );

  console.log(`Files:    ${results.length}`);
  console.log(`Structs:  ${totalStructs}`);
  console.log(`Enums:    ${totalEnums}`);
  console.log(
    chalk.red(`Errors:   ${totalErrors}`) +
      (totalErrors === 0 ? chalk.green(' ✓') : '')
  );
  console.log(
    chalk.yellow(`Warnings: ${totalWarnings}`) +
      (totalWarnings === 0 ? chalk.green(' ✓') : '')
  );
  if (options.strict || totalInfos > 0) {
    console.log(chalk.blue(`Info:     ${totalInfos}`));
  }

  // Exit with error if there are errors
  if (totalErrors > 0) {
    process.exit(1);
  }
}

function getIcon(severity: string): string {
  switch (severity) {
    case 'error':
      return '✗';
    case 'warning':
      return '⚠';
    case 'info':
      return 'ℹ';
    default:
      return '•';
  }
}

function getColor(severity: string): (text: string) => string {
  switch (severity) {
    case 'error':
      return chalk.red;
    case 'warning':
      return chalk.yellow;
    case 'info':
      return chalk.blue;
    default:
      return chalk.white;
  }
}
