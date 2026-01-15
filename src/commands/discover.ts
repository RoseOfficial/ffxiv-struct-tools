/**
 * Discover command - analyze Dalamud memory discovery reports
 */

import { Command } from 'commander';
import fs from 'fs/promises';
import path from 'path';
import chalk from 'chalk';
import yaml from 'js-yaml';
import { glob } from 'glob';
import { parseOffset } from '../lib/types.js';
import type { YamlData, YamlStruct } from '../lib/types.js';

interface DiscoverOptions {
  compare?: string;
  suggest?: boolean;
  json?: boolean;
  output?: string;
  minConfidence?: string;
}

// Types matching the Dalamud discovery report format
interface DiscoveryReport {
  timestamp: string;
  gameVersion: string;
  layouts: DiscoveredLayout[];
  summary: {
    totalStructsAnalyzed: number;
    totalFieldsDiscovered: number;
    totalUndocumentedFields: number;
    totalPointersFound: number;
  };
}

interface DiscoveredLayout {
  structName: string;
  baseAddress: string;
  analyzedSize: number;
  declaredSize?: number;
  timestamp: string;
  vtableAddress?: string;
  vtableSlotCount?: number;
  fields: DiscoveredField[];
  summary: {
    totalFields: number;
    highConfidenceFields: number;
    matchedFields: number;
    undocumentedFields: number;
    paddingBytes: number;
    pointerCount: number;
  };
  messages: string[];
}

interface DiscoveredField {
  offset: number;
  size: number;
  inferredType: string;
  confidence: number;
  value?: string;
  notes?: string;
  rawBytes?: number[];
  pointerTarget?: string;
  declaredName?: string;
  declaredType?: string;
}

interface AnalysisResult {
  timestamp: string;
  reportFile: string;
  yamlFiles?: string[];
  layouts: LayoutAnalysis[];
  summary: {
    totalStructs: number;
    totalUndocumented: number;
    totalHighConfidence: number;
    suggestionsGenerated: number;
  };
}

interface LayoutAnalysis {
  structName: string;
  shortName: string;
  analyzedSize: number;
  declaredSize?: number;
  vtableSlots?: number;
  totalFields: number;
  undocumentedFields: FieldSuggestion[];
  comparison?: {
    matched: number;
    mismatched: number;
    undocumented: number;
  };
}

interface FieldSuggestion {
  offset: number;
  suggestedType: string;
  suggestedName: string;
  confidence: number;
  notes?: string;
  value?: string;
}

export function createDiscoverCommand(): Command {
  const cmd = new Command('discover');

  cmd
    .description('Analyze Dalamud memory discovery reports')
    .argument('<report>', 'Discovery report JSON file from Dalamud plugin')
    .option('--compare <yaml>', 'Compare with YAML definitions (glob pattern)')
    .option('--suggest', 'Generate YAML field suggestions for undocumented fields')
    .option('--json', 'Output results as JSON')
    .option('-o, --output <path>', 'Write results to file')
    .option('--min-confidence <n>', 'Minimum confidence threshold (0-1, default: 0.5)')
    .action(async (reportPath: string, options: DiscoverOptions) => {
      try {
        const exitCode = await runDiscover(reportPath, options);
        process.exit(exitCode);
      } catch (error) {
        console.error(chalk.red('Error:'), (error as Error).message);
        process.exit(1);
      }
    });

  return cmd;
}

async function runDiscover(
  reportPath: string,
  options: DiscoverOptions
): Promise<number> {
  // Load discovery report
  const reportContent = await fs.readFile(reportPath, 'utf-8');
  const report: DiscoveryReport = JSON.parse(reportContent);

  const minConfidence = options.minConfidence ? parseFloat(options.minConfidence) : 0.5;

  // Load YAML files if comparing
  let yamlStructs: Map<string, YamlStruct> | undefined;
  let yamlFiles: string[] = [];

  if (options.compare) {
    yamlFiles = await glob(options.compare, { nodir: true });
    yamlStructs = new Map();

    for (const file of yamlFiles) {
      const content = await fs.readFile(file, 'utf-8');
      const data = yaml.load(content) as YamlData;

      if (data?.structs) {
        for (const struct of data.structs) {
          yamlStructs.set(struct.type, struct);
        }
      }
    }
  }

  // Analyze each layout
  const result: AnalysisResult = {
    timestamp: new Date().toISOString(),
    reportFile: reportPath,
    yamlFiles: yamlFiles.length > 0 ? yamlFiles : undefined,
    layouts: [],
    summary: {
      totalStructs: report.layouts.length,
      totalUndocumented: 0,
      totalHighConfidence: 0,
      suggestionsGenerated: 0,
    },
  };

  for (const layout of report.layouts) {
    const shortName = layout.structName.split('.').pop() || layout.structName;

    const analysis: LayoutAnalysis = {
      structName: layout.structName,
      shortName,
      analyzedSize: layout.analyzedSize,
      declaredSize: layout.declaredSize,
      vtableSlots: layout.vtableSlotCount,
      totalFields: layout.fields.length,
      undocumentedFields: [],
    };

    // Find undocumented fields with sufficient confidence
    for (const field of layout.fields) {
      if (field.inferredType === 'Padding') continue;
      if (field.declaredName) continue; // Already documented
      if (field.confidence < minConfidence) continue;

      const suggestion: FieldSuggestion = {
        offset: field.offset,
        suggestedType: mapInferredType(field.inferredType),
        suggestedName: `Unknown_0x${field.offset.toString(16).toUpperCase()}`,
        confidence: field.confidence,
        notes: field.notes,
        value: field.value,
      };

      analysis.undocumentedFields.push(suggestion);
      result.summary.totalUndocumented++;

      if (field.confidence >= 0.7) {
        result.summary.totalHighConfidence++;
      }
    }

    // Compare with YAML if available
    if (yamlStructs) {
      const yamlStruct = yamlStructs.get(shortName) || yamlStructs.get(layout.structName);
      if (yamlStruct) {
        const declaredOffsets = new Set<number>();
        for (const field of yamlStruct.fields || []) {
          declaredOffsets.add(parseOffset(field.offset));
        }

        let matched = 0;
        let mismatched = 0;

        for (const field of layout.fields) {
          if (field.inferredType === 'Padding') continue;

          if (declaredOffsets.has(field.offset)) {
            matched++;
          } else if (field.confidence >= minConfidence) {
            mismatched++;
          }
        }

        analysis.comparison = {
          matched,
          mismatched,
          undocumented: analysis.undocumentedFields.length,
        };
      }
    }

    if (analysis.undocumentedFields.length > 0 || options.compare) {
      result.layouts.push(analysis);
      result.summary.suggestionsGenerated += analysis.undocumentedFields.length;
    }
  }

  // Output results
  if (options.json) {
    const output = JSON.stringify(result, null, 2);
    if (options.output) {
      await fs.writeFile(options.output, output);
      console.log(chalk.gray(`Results written to: ${options.output}`));
    } else {
      console.log(output);
    }
  } else {
    printAnalysis(result, options.suggest ?? false);

    if (options.output) {
      await fs.writeFile(options.output, JSON.stringify(result, null, 2));
      console.log(chalk.gray(`\nResults written to: ${options.output}`));
    }
  }

  // Generate YAML suggestions if requested
  if (options.suggest) {
    const yamlOutput = generateYamlSuggestions(result, minConfidence);
    const suggestPath = options.output
      ? options.output.replace(/\.json$/, '-suggestions.yaml')
      : path.join(
          path.dirname(reportPath),
          `${path.basename(reportPath, '.json')}-suggestions.yaml`
        );

    await fs.writeFile(suggestPath, yamlOutput);
    console.log(chalk.green(`\nYAML suggestions written to: ${suggestPath}`));
  }

  return result.summary.totalUndocumented > 0 ? 1 : 0;
}

function printAnalysis(result: AnalysisResult, showSuggestions: boolean): void {
  console.log(chalk.bold('\n═══════════════════════════════════════════════════════════════'));
  console.log(chalk.bold('              MEMORY DISCOVERY ANALYSIS REPORT'));
  console.log(chalk.bold('═══════════════════════════════════════════════════════════════\n'));

  // Summary
  console.log(chalk.bold('Summary:'));
  console.log(`  Report:                ${result.reportFile}`);
  console.log(`  Structs Analyzed:      ${result.summary.totalStructs}`);
  console.log(`  Undocumented Fields:   ${chalk.yellow(result.summary.totalUndocumented)}`);
  console.log(`  High Confidence (≥70%): ${chalk.green(result.summary.totalHighConfidence)}`);

  if (result.yamlFiles && result.yamlFiles.length > 0) {
    console.log(`  YAML Files Compared:   ${result.yamlFiles.length}`);
  }

  // Per-struct analysis
  if (result.layouts.length > 0) {
    console.log(chalk.bold('\nStruct Analysis:'));

    for (const layout of result.layouts) {
      const sizeInfo = layout.declaredSize
        ? `0x${layout.analyzedSize.toString(16).toUpperCase()} (declared: 0x${layout.declaredSize.toString(16).toUpperCase()})`
        : `0x${layout.analyzedSize.toString(16).toUpperCase()}`;

      console.log(chalk.cyan(`\n  ${layout.shortName}`));
      console.log(`    Size: ${sizeInfo}`);
      console.log(`    Fields: ${layout.totalFields}`);

      if (layout.vtableSlots) {
        console.log(`    VTable: ${layout.vtableSlots} slots`);
      }

      if (layout.comparison) {
        console.log(`    Matched: ${chalk.green(layout.comparison.matched)}, Undocumented: ${chalk.yellow(layout.comparison.undocumented)}`);
      }

      if (layout.undocumentedFields.length > 0) {
        console.log(chalk.yellow(`    Undocumented Fields (${layout.undocumentedFields.length}):`));

        for (const field of layout.undocumentedFields.slice(0, 10)) {
          const confStr = `${(field.confidence * 100).toFixed(0)}%`;
          const valueStr = field.value ? ` = ${field.value}` : '';
          console.log(
            `      0x${field.offset.toString(16).toUpperCase().padStart(4, '0')} ${field.suggestedType.padEnd(10)} [${confStr}]${valueStr}`
          );
        }

        if (layout.undocumentedFields.length > 10) {
          console.log(chalk.gray(`      ... and ${layout.undocumentedFields.length - 10} more`));
        }
      }
    }
  }

  console.log(chalk.bold('\n═══════════════════════════════════════════════════════════════\n'));
}

function generateYamlSuggestions(result: AnalysisResult, minConfidence: number): string {
  const lines: string[] = [
    '# Auto-generated field suggestions from memory discovery',
    `# Generated: ${result.timestamp}`,
    `# Minimum confidence: ${(minConfidence * 100).toFixed(0)}%`,
    '',
    '# Copy relevant fields to your struct definitions',
    '',
  ];

  for (const layout of result.layouts) {
    if (layout.undocumentedFields.length === 0) continue;

    lines.push(`# ${layout.structName}`);
    lines.push(`# Analyzed size: 0x${layout.analyzedSize.toString(16).toUpperCase()}`);
    lines.push('');

    for (const field of layout.undocumentedFields) {
      const confPercent = (field.confidence * 100).toFixed(0);
      lines.push(`      # ${field.suggestedName} - confidence: ${confPercent}%`);

      if (field.notes) {
        lines.push(`      # ${field.notes}`);
      }

      lines.push(`      - type: ${field.suggestedType}`);
      lines.push(`        name: ${field.suggestedName}`);
      lines.push(`        offset: 0x${field.offset.toString(16).toUpperCase()}`);

      if (field.value) {
        lines.push(`        # value: ${field.value}`);
      }

      lines.push('');
    }

    lines.push('');
  }

  return lines.join('\n');
}

function mapInferredType(inferredType: string): string {
  const typeMap: Record<string, string> = {
    Pointer: 'void*',
    VTablePointer: 'void*',
    StringPointer: 'byte*',
    Float: 'float',
    Double: 'double',
    Bool: 'bool',
    Byte: 'byte',
    Int16: 'short',
    Int32: 'int',
    Int64: 'long',
    Enum: 'int',
    Unknown: 'byte',
    Padding: 'byte',
  };

  return typeMap[inferredType] || 'byte';
}
