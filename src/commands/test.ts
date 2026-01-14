/**
 * Test command - run comprehensive validation with CI integration
 */

import { Command } from 'commander';
import { glob } from 'glob';
import fs from 'fs/promises';
import path from 'path';
import chalk from 'chalk';
import yaml from 'js-yaml';
import type { YamlData, YamlStruct, YamlEnum, ValidationResult } from '../lib/types.js';
import { validateStruct, validateEnum } from '../lib/validators.js';

interface TestOptions {
  baseline?: string;
  updateBaseline?: boolean;
  json?: boolean;
  strict?: boolean;
  failOnWarning?: boolean;
  output?: string;
}

interface TestReport {
  timestamp: string;
  files: string[];
  summary: {
    totalStructs: number;
    totalEnums: number;
    totalErrors: number;
    totalWarnings: number;
    totalInfo: number;
    passed: boolean;
  };
  results: ValidationResult[];
  baselineComparison?: {
    newIssues: number;
    resolvedIssues: number;
    unchangedIssues: number;
  };
}

interface BaselineData {
  timestamp: string;
  issues: Array<{
    file: string;
    rule: string;
    severity: string;
    struct?: string;
    field?: string;
    message: string;
  }>;
}

export function createTestCommand(): Command {
  const cmd = new Command('test');

  cmd
    .description('Run comprehensive validation tests with CI integration')
    .argument('<files...>', 'YAML files to test (supports glob patterns)')
    .option('-b, --baseline <path>', 'Compare against baseline file')
    .option('-u, --update-baseline', 'Update baseline file with current results')
    .option('--json', 'Output results as JSON')
    .option('--strict', 'Enable strict mode (additional checks)')
    .option('--fail-on-warning', 'Exit with error code on warnings')
    .option('-o, --output <path>', 'Write test report to file')
    .action(async (filePatterns: string[], options: TestOptions) => {
      try {
        const exitCode = await runTests(filePatterns, options);
        process.exit(exitCode);
      } catch (error) {
        console.error(chalk.red('Error:'), (error as Error).message);
        process.exit(1);
      }
    });

  return cmd;
}

async function runTests(
  filePatterns: string[],
  options: TestOptions
): Promise<number> {
  // Expand glob patterns
  const files: string[] = [];
  for (const pattern of filePatterns) {
    const matches = await glob(pattern, { nodir: true });
    files.push(...matches);
  }

  if (files.length === 0) {
    console.error(chalk.red('No files matched the given patterns'));
    return 1;
  }

  // Run validation on all files
  const results: ValidationResult[] = [];
  let totalStructs = 0;
  let totalEnums = 0;

  // Collect all struct and enum names across all files first
  const allStructNames = new Set<string>();
  const allEnumNames = new Set<string>();

  for (const file of files) {
    const content = await fs.readFile(file, 'utf-8');
    const data = yaml.load(content) as YamlData;

    if (data?.structs) {
      for (const struct of data.structs) {
        if (struct.type) allStructNames.add(struct.type);
      }
    }
    if (data?.enums) {
      for (const enumDef of data.enums) {
        if (enumDef.type) allEnumNames.add(enumDef.type);
      }
    }
  }

  // Now validate each file
  for (const file of files) {
    const content = await fs.readFile(file, 'utf-8');
    const data = yaml.load(content) as YamlData;

    const result: ValidationResult = {
      file,
      issues: [],
      stats: { structs: 0, enums: 0, errors: 0, warnings: 0 },
    };

    const context = {
      allStructNames,
      allEnumNames,
      options: {
        strict: options.strict,
      },
    };

    // Validate structs
    if (data?.structs) {
      result.stats.structs = data.structs.length;
      totalStructs += data.structs.length;

      for (const struct of data.structs) {
        const issues = validateStruct(struct, context);
        result.issues.push(...issues);
      }
    }

    // Validate enums
    if (data?.enums) {
      result.stats.enums = data.enums.length;
      totalEnums += data.enums.length;

      for (const enumDef of data.enums) {
        const issues = validateEnum(enumDef, context);
        result.issues.push(...issues);
      }
    }

    // Count by severity
    result.stats.errors = result.issues.filter(i => i.severity === 'error').length;
    result.stats.warnings = result.issues.filter(i => i.severity === 'warning').length;

    results.push(result);
  }

  // Calculate totals
  const totalErrors = results.reduce((sum, r) => sum + r.stats.errors, 0);
  const totalWarnings = results.reduce((sum, r) => sum + r.stats.warnings, 0);
  const totalInfo = results.reduce(
    (sum, r) => sum + r.issues.filter(i => i.severity === 'info').length,
    0
  );

  // Determine pass/fail
  const passed = totalErrors === 0 && (!options.failOnWarning || totalWarnings === 0);

  // Build test report
  const report: TestReport = {
    timestamp: new Date().toISOString(),
    files,
    summary: {
      totalStructs,
      totalEnums,
      totalErrors,
      totalWarnings,
      totalInfo,
      passed,
    },
    results,
  };

  // Handle baseline comparison
  let baseline: BaselineData | null = null;
  if (options.baseline) {
    try {
      const baselineContent = await fs.readFile(options.baseline, 'utf-8');
      baseline = JSON.parse(baselineContent) as BaselineData;
    } catch (error) {
      if (!options.updateBaseline) {
        console.warn(chalk.yellow(`Warning: Could not read baseline file: ${options.baseline}`));
      }
    }
  }

  if (baseline) {
    const currentIssues = flattenIssues(results);
    const baselineIssueSet = new Set(baseline.issues.map(i => issueKey(i)));
    const currentIssueSet = new Set(currentIssues.map(i => issueKey(i)));

    let newIssues = 0;
    let resolvedIssues = 0;
    let unchangedIssues = 0;

    for (const issue of currentIssues) {
      if (!baselineIssueSet.has(issueKey(issue))) {
        newIssues++;
      } else {
        unchangedIssues++;
      }
    }

    for (const issue of baseline.issues) {
      if (!currentIssueSet.has(issueKey(issue))) {
        resolvedIssues++;
      }
    }

    report.baselineComparison = { newIssues, resolvedIssues, unchangedIssues };
  }

  // Update baseline if requested
  if (options.updateBaseline && options.baseline) {
    const newBaseline: BaselineData = {
      timestamp: new Date().toISOString(),
      issues: flattenIssues(results),
    };
    await fs.writeFile(options.baseline, JSON.stringify(newBaseline, null, 2));
    if (!options.json) {
      console.log(chalk.green(`✓ Baseline updated: ${options.baseline}`));
    }
  }

  // Output results
  if (options.json) {
    const output = JSON.stringify(report, null, 2);
    if (options.output) {
      await fs.writeFile(options.output, output);
    } else {
      console.log(output);
    }
  } else {
    printReport(report, options);
    if (options.output) {
      await fs.writeFile(options.output, JSON.stringify(report, null, 2));
      console.log(chalk.gray(`\nReport written to: ${options.output}`));
    }
  }

  return passed ? 0 : 1;
}

function flattenIssues(results: ValidationResult[]): BaselineData['issues'] {
  const issues: BaselineData['issues'] = [];
  for (const result of results) {
    for (const issue of result.issues) {
      issues.push({
        file: result.file,
        rule: issue.rule,
        severity: issue.severity,
        struct: issue.struct,
        field: issue.field,
        message: issue.message,
      });
    }
  }
  return issues;
}

function issueKey(issue: BaselineData['issues'][0]): string {
  return `${issue.file}:${issue.rule}:${issue.struct || ''}:${issue.field || ''}`;
}

function printReport(report: TestReport, options: TestOptions): void {
  console.log(chalk.bold('\n═══════════════════════════════════════════════════════════════'));
  console.log(chalk.bold('                     VALIDATION TEST REPORT'));
  console.log(chalk.bold('═══════════════════════════════════════════════════════════════\n'));

  // Summary
  console.log(chalk.bold('Summary:'));
  console.log(`  Files:     ${report.files.length}`);
  console.log(`  Structs:   ${report.summary.totalStructs}`);
  console.log(`  Enums:     ${report.summary.totalEnums}`);
  console.log(`  Errors:    ${colorCount(report.summary.totalErrors, 'error')}`);
  console.log(`  Warnings:  ${colorCount(report.summary.totalWarnings, 'warning')}`);
  console.log(`  Info:      ${colorCount(report.summary.totalInfo, 'info')}`);

  // Baseline comparison
  if (report.baselineComparison) {
    console.log(chalk.bold('\nBaseline Comparison:'));
    if (report.baselineComparison.newIssues > 0) {
      console.log(`  New issues:      ${chalk.red(report.baselineComparison.newIssues)}`);
    } else {
      console.log(`  New issues:      ${chalk.green('0')}`);
    }
    if (report.baselineComparison.resolvedIssues > 0) {
      console.log(`  Resolved:        ${chalk.green(report.baselineComparison.resolvedIssues)}`);
    } else {
      console.log(`  Resolved:        ${chalk.gray('0')}`);
    }
    console.log(`  Unchanged:       ${report.baselineComparison.unchangedIssues}`);
  }

  // Per-file results
  const filesWithIssues = report.results.filter(r => r.issues.length > 0);
  if (filesWithIssues.length > 0) {
    console.log(chalk.bold('\nIssues by File:'));
    for (const result of filesWithIssues) {
      const relPath = path.relative(process.cwd(), result.file);
      console.log(`\n  ${chalk.underline(relPath)}:`);

      // Group by struct
      const byStruct = new Map<string, typeof result.issues>();
      for (const issue of result.issues) {
        const key = issue.struct || '<global>';
        if (!byStruct.has(key)) byStruct.set(key, []);
        byStruct.get(key)!.push(issue);
      }

      for (const [struct, issues] of byStruct) {
        console.log(`    ${chalk.cyan(struct)}:`);
        for (const issue of issues) {
          const icon = severityIcon(issue.severity);
          const color = severityColor(issue.severity);
          const fieldPart = issue.field ? ` [${issue.field}]` : '';
          console.log(`      ${icon} ${color(`[${issue.rule}]`)}${fieldPart} ${issue.message}`);
        }
      }
    }
  }

  // Final result
  console.log(chalk.bold('\n═══════════════════════════════════════════════════════════════'));
  if (report.summary.passed) {
    console.log(chalk.green.bold('  ✓ ALL TESTS PASSED'));
  } else {
    console.log(chalk.red.bold('  ✗ TESTS FAILED'));
    if (report.summary.totalErrors > 0) {
      console.log(chalk.red(`    ${report.summary.totalErrors} error(s) found`));
    }
    if (options.failOnWarning && report.summary.totalWarnings > 0) {
      console.log(chalk.yellow(`    ${report.summary.totalWarnings} warning(s) found (--fail-on-warning)`));
    }
  }
  console.log(chalk.bold('═══════════════════════════════════════════════════════════════\n'));
}

function colorCount(count: number, severity: string): string {
  if (count === 0) return chalk.green('0');
  switch (severity) {
    case 'error':
      return chalk.red(String(count));
    case 'warning':
      return chalk.yellow(String(count));
    default:
      return chalk.blue(String(count));
  }
}

function severityIcon(severity: string): string {
  switch (severity) {
    case 'error':
      return chalk.red('✗');
    case 'warning':
      return chalk.yellow('⚠');
    default:
      return chalk.blue('ℹ');
  }
}

function severityColor(severity: string): typeof chalk {
  switch (severity) {
    case 'error':
      return chalk.red;
    case 'warning':
      return chalk.yellow;
    default:
      return chalk.blue;
  }
}
