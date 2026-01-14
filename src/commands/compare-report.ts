/**
 * Compare-report command - compare YAML definitions with Dalamud validation reports
 */

import { Command } from 'commander';
import fs from 'fs/promises';
import path from 'path';
import chalk from 'chalk';
import yaml from 'js-yaml';
import { glob } from 'glob';
import type { YamlData } from '../lib/types.js';

interface CompareOptions {
  json?: boolean;
  output?: string;
}

// Dalamud report types (matching ValidationModels.cs)
interface DalamudReport {
  timestamp: string;
  gameVersion: string;
  summary: {
    totalStructs: number;
    passedStructs: number;
    failedStructs: number;
    totalIssues: number;
    errorCount: number;
    warningCount: number;
    infoCount: number;
  };
  results: DalamudStructResult[];
}

interface DalamudStructResult {
  structName: string;
  namespace: string;
  passed: boolean;
  declaredSize?: number;
  actualSize?: number;
  baseType?: string;
  baseTypeSize?: number;
  issues: DalamudIssue[];
  fieldValidations?: DalamudFieldValidation[];
}

interface DalamudIssue {
  severity: string;
  rule: string;
  field?: string;
  message: string;
  expected?: string;
  actual?: string;
}

interface DalamudFieldValidation {
  name: string;
  offset: number;
  type: string;
  size: number;
}

interface ComparisonResult {
  timestamp: string;
  yamlFiles: string[];
  dalamudReport: string;
  summary: {
    structsInYaml: number;
    structsInReport: number;
    matched: number;
    mismatches: number;
    missingInYaml: number;
    missingInReport: number;
  };
  mismatches: StructMismatch[];
  missingInYaml: string[];
  missingInReport: string[];
}

interface StructMismatch {
  structName: string;
  yamlSize?: number;
  actualSize?: number;
  issues: string[];
}

export function createCompareReportCommand(): Command {
  const cmd = new Command('compare-report');

  cmd
    .description('Compare YAML definitions with Dalamud validation report')
    .argument('<yaml-files>', 'YAML file(s) or glob pattern')
    .argument('<report>', 'Dalamud JSON report file')
    .option('--json', 'Output results as JSON')
    .option('-o, --output <path>', 'Write comparison report to file')
    .action(async (yamlPattern: string, reportPath: string, options: CompareOptions) => {
      try {
        const exitCode = await runCompare(yamlPattern, reportPath, options);
        process.exit(exitCode);
      } catch (error) {
        console.error(chalk.red('Error:'), (error as Error).message);
        process.exit(1);
      }
    });

  return cmd;
}

async function runCompare(
  yamlPattern: string,
  reportPath: string,
  options: CompareOptions
): Promise<number> {
  // Load Dalamud report
  const reportContent = await fs.readFile(reportPath, 'utf-8');
  const dalamudReport: DalamudReport = JSON.parse(reportContent);

  // Load YAML files
  const yamlFiles = await glob(yamlPattern, { nodir: true });
  if (yamlFiles.length === 0) {
    console.error(chalk.red('No YAML files matched the pattern'));
    return 1;
  }

  // Build map of YAML structs
  const yamlStructs = new Map<string, { size?: number; file: string }>();

  for (const file of yamlFiles) {
    const content = await fs.readFile(file, 'utf-8');
    const data = yaml.load(content) as YamlData;

    if (data?.structs) {
      for (const struct of data.structs) {
        yamlStructs.set(struct.type, {
          size: struct.size,
          file,
        });
      }
    }
  }

  // Build map of Dalamud results
  const dalamudResults = new Map<string, DalamudStructResult>();
  for (const result of dalamudReport.results) {
    // Try both full name and short name
    dalamudResults.set(result.structName, result);
    const shortName = result.structName.split('.').pop() || result.structName;
    if (!dalamudResults.has(shortName)) {
      dalamudResults.set(shortName, result);
    }
  }

  // Compare
  const comparison: ComparisonResult = {
    timestamp: new Date().toISOString(),
    yamlFiles,
    dalamudReport: reportPath,
    summary: {
      structsInYaml: yamlStructs.size,
      structsInReport: dalamudReport.results.length,
      matched: 0,
      mismatches: 0,
      missingInYaml: 0,
      missingInReport: 0,
    },
    mismatches: [],
    missingInYaml: [],
    missingInReport: [],
  };

  // Check each YAML struct against Dalamud results
  for (const [name, yamlStruct] of yamlStructs) {
    const dalamudResult = dalamudResults.get(name);

    if (!dalamudResult) {
      comparison.missingInReport.push(name);
      comparison.summary.missingInReport++;
      continue;
    }

    // Check for size mismatch
    const issues: string[] = [];

    if (yamlStruct.size && dalamudResult.actualSize) {
      if (yamlStruct.size !== dalamudResult.actualSize) {
        issues.push(
          `Size mismatch: YAML declares 0x${yamlStruct.size.toString(16).toUpperCase()}, ` +
          `actual is 0x${dalamudResult.actualSize.toString(16).toUpperCase()}`
        );
      }
    }

    // Include issues from Dalamud report
    for (const issue of dalamudResult.issues) {
      if (issue.severity === 'error') {
        issues.push(`[${issue.rule}] ${issue.message}`);
      }
    }

    if (issues.length > 0) {
      comparison.mismatches.push({
        structName: name,
        yamlSize: yamlStruct.size,
        actualSize: dalamudResult.actualSize,
        issues,
      });
      comparison.summary.mismatches++;
    } else {
      comparison.summary.matched++;
    }
  }

  // Find structs in Dalamud report but not in YAML
  for (const result of dalamudReport.results) {
    const shortName = result.structName.split('.').pop() || result.structName;
    if (!yamlStructs.has(shortName) && !yamlStructs.has(result.structName)) {
      comparison.missingInYaml.push(result.structName);
      comparison.summary.missingInYaml++;
    }
  }

  // Output results
  if (options.json) {
    const output = JSON.stringify(comparison, null, 2);
    if (options.output) {
      await fs.writeFile(options.output, output);
    } else {
      console.log(output);
    }
  } else {
    printComparison(comparison);
    if (options.output) {
      await fs.writeFile(options.output, JSON.stringify(comparison, null, 2));
      console.log(chalk.gray(`\nReport written to: ${options.output}`));
    }
  }

  return comparison.summary.mismatches > 0 ? 1 : 0;
}

function printComparison(comparison: ComparisonResult): void {
  console.log(chalk.bold('\n═══════════════════════════════════════════════════════════════'));
  console.log(chalk.bold('              YAML vs DALAMUD COMPARISON REPORT'));
  console.log(chalk.bold('═══════════════════════════════════════════════════════════════\n'));

  // Summary
  console.log(chalk.bold('Summary:'));
  console.log(`  YAML Structs:        ${comparison.summary.structsInYaml}`);
  console.log(`  Dalamud Structs:     ${comparison.summary.structsInReport}`);
  console.log(`  Matched:             ${chalk.green(comparison.summary.matched)}`);
  console.log(`  Mismatches:          ${comparison.summary.mismatches > 0 ? chalk.red(comparison.summary.mismatches) : chalk.green('0')}`);
  console.log(`  Missing in YAML:     ${comparison.summary.missingInYaml}`);
  console.log(`  Missing in Report:   ${comparison.summary.missingInReport}`);

  // Mismatches
  if (comparison.mismatches.length > 0) {
    console.log(chalk.bold('\nMismatches:'));
    for (const mismatch of comparison.mismatches) {
      console.log(chalk.red(`\n  ${mismatch.structName}:`));
      if (mismatch.yamlSize !== undefined) {
        console.log(`    YAML Size:   0x${mismatch.yamlSize.toString(16).toUpperCase()}`);
      }
      if (mismatch.actualSize !== undefined) {
        console.log(`    Actual Size: 0x${mismatch.actualSize.toString(16).toUpperCase()}`);
      }
      for (const issue of mismatch.issues) {
        console.log(chalk.yellow(`    • ${issue}`));
      }
    }
  }

  // Missing in YAML (first 10)
  if (comparison.missingInYaml.length > 0) {
    console.log(chalk.bold('\nStructs in game but not in YAML (first 10):'));
    for (const name of comparison.missingInYaml.slice(0, 10)) {
      console.log(chalk.gray(`  • ${name}`));
    }
    if (comparison.missingInYaml.length > 10) {
      console.log(chalk.gray(`  ... and ${comparison.missingInYaml.length - 10} more`));
    }
  }

  // Final result
  console.log(chalk.bold('\n═══════════════════════════════════════════════════════════════'));
  if (comparison.summary.mismatches === 0) {
    console.log(chalk.green.bold('  ✓ ALL STRUCTS MATCH'));
  } else {
    console.log(chalk.red.bold(`  ✗ ${comparison.summary.mismatches} MISMATCH(ES) FOUND`));
  }
  console.log(chalk.bold('═══════════════════════════════════════════════════════════════\n'));
}
