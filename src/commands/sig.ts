/**
 * sig command - Signature-based automatic offset discovery
 *
 * Subcommands:
 *   extract - Extract signatures from binary + YAML
 *   scan    - Scan new binary for signature matches
 *   status  - Report signature health/coverage
 */

import * as fs from 'fs';
import * as path from 'path';
import { glob } from 'glob';
import chalk from 'chalk';
import { Command } from 'commander';
import { parseYamlFile, type ParsedFile } from '../lib/yaml-parser.js';
import { toHex, parseOffset } from '../lib/types.js';
import {
  type Signature,
  type StructSignatures,
  type ScanResult,
  type SignatureMatch,
  type FieldChange,
  type ChangePattern,
  serializeSignatures,
  SIGNATURE_TYPE_WEIGHTS,
} from '../lib/signatures.js';
import {
  BinaryScanner,
  generateCandidatePatterns,
  detectGameVersion,
} from '../lib/binary-scanner.js';

// ============================================================================
// Types
// ============================================================================

export interface SigExtractOptions {
  output?: string;
  version?: string;
  minConfidence?: string;
  json?: boolean;
}

export interface SigScanOptions {
  sigs?: string[];
  output?: string;
  minConfidence?: string;
  json?: boolean;
}

export interface SigStatusOptions {
  json?: boolean;
}

// ============================================================================
// Extract Command
// ============================================================================

/**
 * Extract signatures from a binary based on YAML struct definitions
 */
export async function runSigExtract(
  binaryPath: string,
  yamlPatterns: string[],
  options: SigExtractOptions
): Promise<void> {
  // Verify binary exists
  if (!fs.existsSync(binaryPath)) {
    console.error(chalk.red(`Binary not found: ${binaryPath}`));
    process.exit(1);
  }

  // Expand glob patterns for YAML files
  const yamlPaths: string[] = [];
  for (const pattern of yamlPatterns) {
    const matches = await glob(pattern, { nodir: true });
    yamlPaths.push(...matches);
  }

  if (yamlPaths.length === 0) {
    console.error(chalk.red('No YAML files found matching the provided patterns'));
    process.exit(1);
  }

  console.log(chalk.blue(`Loading binary: ${binaryPath}`));
  const scanner = BinaryScanner.fromFile(binaryPath);
  const peInfo = scanner.getPEInfo();

  if (!peInfo.valid) {
    console.error(chalk.red('Invalid PE file'));
    process.exit(1);
  }

  console.log(chalk.gray(`  PE Type: ${peInfo.is64Bit ? 'PE32+ (64-bit)' : 'PE32 (32-bit)'}`));
  console.log(chalk.gray(`  Sections: ${peInfo.sections.length}`));
  console.log(chalk.gray(`  Hash: ${scanner.getHash().substring(0, 16)}...`));

  // Try to detect game version
  const detectedVersion = detectGameVersion(scanner);
  const version = options.version || detectedVersion || 'unknown';
  console.log(chalk.gray(`  Version: ${version}${detectedVersion ? ' (detected)' : ''}`));

  // Parse YAML files
  console.log(chalk.blue(`\nParsing ${yamlPaths.length} YAML file(s)...`));
  const parsedFiles: ParsedFile[] = [];
  for (const yamlPath of yamlPaths) {
    try {
      parsedFiles.push(parseYamlFile(yamlPath));
    } catch (error) {
      console.error(chalk.red(`Failed to parse ${yamlPath}:`), error);
      process.exit(1);
    }
  }

  // Extract signatures for each struct
  const allSignatures: StructSignatures[] = [];
  let totalSigs = 0;
  let totalFields = 0;

  const minConfidence = parseInt(options.minConfidence || '70', 10);

  // Build displacement index for fast lookups (one-time scan of binary)
  console.log(chalk.blue('\nBuilding displacement index (one-time scan)...'));
  const startIndex = Date.now();
  scanner.buildDisplacementIndex();
  const indexStats = scanner.getIndexStats();
  console.log(chalk.gray(`  Indexed ${indexStats.uniqueOffsets} unique offsets (${indexStats.totalEntries} total references)`));
  console.log(chalk.gray(`  Index built in ${Date.now() - startIndex}ms`));

  console.log(chalk.blue('\nExtracting signatures...\n'));

  for (const parsed of parsedFiles) {
    for (const struct of parsed.structs) {
      const signatures: Signature[] = [];

      // Try to find signatures for each field with an offset using the index
      for (const field of struct.fields || []) {
        if (field.offset === undefined) continue;

        totalFields++;
        const offset = parseOffset(field.offset);

        // Use the pre-built index for O(1) lookup instead of O(n) scan
        const matches = scanner.lookupOffset(offset);

        if (matches.length > 0 && matches.length <= 10) {
          // Found a reasonable number of matches
          const baseConfidence = SIGNATURE_TYPE_WEIGHTS.field_access;
          const uniquenessBonus = matches.length === 1 ? 10 : -Math.min(20, (matches.length - 1) * 5);
          const confidence = Math.max(0, Math.min(100, baseConfidence + uniquenessBonus));

          if (confidence >= minConfidence) {
            // Use the first match's instruction bytes as the pattern
            const firstMatch = matches[0];
            const pattern = firstMatch.instrBytes.match(/.{2}/g)!.join(' ');

            signatures.push({
              type: 'field_access',
              struct: struct.type,
              field: field.name || `field_${toHex(offset)}`,
              offset,
              pattern,
              confidence,
              notes: matches.length > 1 ? `${matches.length} matches found` : undefined,
            });
            totalSigs++;
          }
        }
      }

      // Also look for RTTI strings for vtable
      const rttiPattern = struct.type + '@@';
      const rttiMatches = scanner.findStrings(rttiPattern);
      if (rttiMatches.length > 0) {
        signatures.push({
          type: 'rtti',
          struct: struct.type,
          field: '_rtti',
          offset: 0,
          pattern: rttiPattern,
          confidence: SIGNATURE_TYPE_WEIGHTS.rtti,
          notes: `Found at offset ${toHex(rttiMatches[0].offset)}`,
        });
        totalSigs++;
      }

      if (signatures.length > 0) {
        allSignatures.push({
          struct: struct.type,
          version,
          binaryHash: scanner.getHash(),
          extractedAt: new Date().toISOString(),
          signatures,
        });

        if (!options.json) {
          console.log(
            chalk.green(`  ${struct.type}: `) +
              chalk.white(`${signatures.length} signatures`)
          );
        }
      }
    }
  }

  // Output results
  if (options.json) {
    console.log(JSON.stringify(allSignatures, null, 2));
    return;
  }

  console.log(chalk.blue('\n───────────────────────────────────'));
  console.log(chalk.blue('Extraction Summary'));
  console.log(chalk.blue('───────────────────────────────────'));
  console.log(`Structs processed: ${allSignatures.length}`);
  console.log(`Fields analyzed:   ${totalFields}`);
  console.log(`Signatures found:  ${totalSigs}`);
  console.log(
    `Coverage:          ${totalFields > 0 ? Math.round((totalSigs / totalFields) * 100) : 0}%`
  );

  // Write output
  if (options.output) {
    const outputPath = options.output;
    const outputData = JSON.stringify(allSignatures, null, 2);
    fs.writeFileSync(outputPath, outputData);
    console.log(chalk.green(`\nSignatures written to: ${outputPath}`));
  } else {
    // Write individual .sigs.yaml files alongside input
    for (const sigs of allSignatures) {
      const outputPath = `${sigs.struct}.sigs.yaml`;
      fs.writeFileSync(outputPath, serializeSignatures(sigs));
    }
    console.log(chalk.green(`\nSignatures written to individual .sigs.yaml files`));
  }
}

// ============================================================================
// Scan Command
// ============================================================================

/**
 * Scan a binary for signature matches
 */
export async function runSigScan(
  binaryPath: string,
  options: SigScanOptions
): Promise<void> {
  // Verify binary exists
  if (!fs.existsSync(binaryPath)) {
    console.error(chalk.red(`Binary not found: ${binaryPath}`));
    process.exit(1);
  }

  // Find signature files
  const sigPatterns = options.sigs || ['*.sigs.yaml', '*.sigs.json'];
  const sigPaths: string[] = [];
  for (const pattern of sigPatterns) {
    const matches = await glob(pattern, { nodir: true });
    sigPaths.push(...matches);
  }

  if (sigPaths.length === 0) {
    console.error(chalk.red('No signature files found. Run `fst sig extract` first.'));
    process.exit(1);
  }

  console.log(chalk.blue(`Loading binary: ${binaryPath}`));
  const scanner = BinaryScanner.fromFile(binaryPath);
  const peInfo = scanner.getPEInfo();

  if (!peInfo.valid) {
    console.error(chalk.red('Invalid PE file'));
    process.exit(1);
  }

  console.log(chalk.gray(`  Hash: ${scanner.getHash().substring(0, 16)}...`));

  // Load signature files
  console.log(chalk.blue(`\nLoading ${sigPaths.length} signature file(s)...`));
  const sigCollections: StructSignatures[] = [];

  for (const sigPath of sigPaths) {
    try {
      const content = fs.readFileSync(sigPath, 'utf-8');
      // Support both JSON and YAML-ish format (parse as JSON for now)
      if (sigPath.endsWith('.json')) {
        const data = JSON.parse(content);
        if (Array.isArray(data)) {
          sigCollections.push(...data);
        } else {
          sigCollections.push(data);
        }
      } else {
        // For YAML format, try JSON parse first (our serialization is JSON-compatible for signatures array)
        try {
          const data = JSON.parse(content);
          sigCollections.push(data);
        } catch {
          console.warn(chalk.yellow(`  Warning: Could not parse ${sigPath}, skipping`));
        }
      }
    } catch (error) {
      console.error(chalk.red(`Failed to load ${sigPath}:`), error);
    }
  }

  if (sigCollections.length === 0) {
    console.error(chalk.red('No valid signatures loaded'));
    process.exit(1);
  }

  // Scan for signatures
  console.log(chalk.blue('\nScanning for signatures...\n'));
  const result = scanner.scan(sigCollections);
  result.binary = binaryPath;

  const minConfidence = parseInt(options.minConfidence || '0', 10);

  // Output results
  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  // Print match results
  const matchedSigs = result.matches.filter((m) => m.found);
  const missingSigs = result.matches.filter((m) => !m.found);

  console.log(chalk.green(`Matched: ${matchedSigs.length}/${result.signaturesTotal}`));
  console.log(chalk.red(`Missing: ${missingSigs.length}/${result.signaturesTotal}`));

  // Print changes
  if (result.changes.length > 0) {
    console.log(chalk.blue('\n───────────────────────────────────'));
    console.log(chalk.blue('Detected Changes'));
    console.log(chalk.blue('───────────────────────────────────\n'));

    const filteredChanges = result.changes.filter((c) => c.confidence >= minConfidence);

    // Group by struct
    const byStruct = new Map<string, FieldChange[]>();
    for (const change of filteredChanges) {
      if (!byStruct.has(change.struct)) {
        byStruct.set(change.struct, []);
      }
      byStruct.get(change.struct)!.push(change);
    }

    for (const [structName, changes] of byStruct) {
      console.log(chalk.cyan(`${structName}:`));
      for (const change of changes) {
        const delta = change.newOffset - change.oldOffset;
        const deltaStr = delta >= 0 ? `+${toHex(delta)}` : toHex(delta);
        const confColor = change.confidence >= 90 ? chalk.green : change.confidence >= 70 ? chalk.yellow : chalk.red;

        console.log(
          `  ${change.field}: ${toHex(change.oldOffset)} → ${toHex(change.newOffset)} ` +
            chalk.gray(`(${deltaStr})`) +
            ` ` +
            confColor(`[${change.confidence}%]`)
        );
      }
    }
  }

  // Print detected patterns
  if (result.patternGroups.length > 0) {
    console.log(chalk.blue('\n───────────────────────────────────'));
    console.log(chalk.blue('Detected Patterns'));
    console.log(chalk.blue('───────────────────────────────────\n'));

    for (const pattern of result.patternGroups) {
      const deltaStr = pattern.delta >= 0 ? `+${toHex(pattern.delta)}` : toHex(pattern.delta);
      const confColor = pattern.confidence >= 90 ? chalk.green : pattern.confidence >= 70 ? chalk.yellow : chalk.red;

      console.log(chalk.white(`${pattern.name}`));
      console.log(`  Delta: ${deltaStr}`);
      console.log(`  Affected: ${pattern.affectedStructs.length} struct(s)`);
      console.log(`  Confidence: ${confColor(pattern.confidence + '%')}`);
      if (pattern.likelyCause) {
        console.log(chalk.gray(`  Likely cause: ${pattern.likelyCause}`));
      }
      console.log();
    }
  }

  // Print missing signatures
  if (missingSigs.length > 0 && missingSigs.length <= 20) {
    console.log(chalk.blue('\n───────────────────────────────────'));
    console.log(chalk.blue('Missing Signatures'));
    console.log(chalk.blue('───────────────────────────────────\n'));

    for (const match of missingSigs) {
      console.log(chalk.yellow(`  ${match.signature.struct}.${match.signature.field}`));
    }
  }

  // Summary
  console.log(chalk.blue('\n───────────────────────────────────'));
  console.log(chalk.blue('Scan Summary'));
  console.log(chalk.blue('───────────────────────────────────'));
  console.log(`Binary:            ${path.basename(binaryPath)}`);
  console.log(`Signatures:        ${result.signaturesMatched}/${result.signaturesTotal} matched`);
  console.log(`Changes detected:  ${result.changes.length}`);
  console.log(`Patterns found:    ${result.patternGroups.length}`);

  // Write output
  if (options.output) {
    fs.writeFileSync(options.output, JSON.stringify(result, null, 2));
    console.log(chalk.green(`\nResults written to: ${options.output}`));
  }
}

// ============================================================================
// Status Command
// ============================================================================

/**
 * Report signature health and coverage
 */
export async function runSigStatus(
  patterns: string[],
  options: SigStatusOptions
): Promise<void> {
  // Find signature files
  const sigPaths: string[] = [];
  for (const pattern of patterns.length > 0 ? patterns : ['*.sigs.yaml', '*.sigs.json']) {
    const matches = await glob(pattern, { nodir: true });
    sigPaths.push(...matches);
  }

  if (sigPaths.length === 0) {
    console.error(chalk.red('No signature files found'));
    process.exit(1);
  }

  // Load and analyze signature files
  const stats = {
    files: 0,
    structs: 0,
    signatures: 0,
    byType: {} as Record<string, number>,
    avgConfidence: 0,
    lowConfidence: 0,
    highConfidence: 0,
  };

  const structList: Array<{ name: string; sigCount: number; avgConf: number }> = [];

  for (const sigPath of sigPaths) {
    try {
      const content = fs.readFileSync(sigPath, 'utf-8');
      let data: StructSignatures | StructSignatures[];

      if (sigPath.endsWith('.json')) {
        data = JSON.parse(content);
      } else {
        // Try JSON parse
        try {
          data = JSON.parse(content);
        } catch {
          continue;
        }
      }

      const collections = Array.isArray(data) ? data : [data];
      stats.files++;

      for (const sigs of collections) {
        stats.structs++;

        let structConfSum = 0;
        for (const sig of sigs.signatures) {
          stats.signatures++;
          stats.byType[sig.type] = (stats.byType[sig.type] || 0) + 1;
          stats.avgConfidence += sig.confidence;
          structConfSum += sig.confidence;

          if (sig.confidence < 70) {
            stats.lowConfidence++;
          } else if (sig.confidence >= 90) {
            stats.highConfidence++;
          }
        }

        if (sigs.signatures.length > 0) {
          structList.push({
            name: sigs.struct,
            sigCount: sigs.signatures.length,
            avgConf: Math.round(structConfSum / sigs.signatures.length),
          });
        }
      }
    } catch (error) {
      console.warn(chalk.yellow(`Warning: Could not parse ${sigPath}`));
    }
  }

  if (stats.signatures > 0) {
    stats.avgConfidence = Math.round(stats.avgConfidence / stats.signatures);
  }

  // Output results
  if (options.json) {
    console.log(JSON.stringify({ stats, structs: structList }, null, 2));
    return;
  }

  console.log(chalk.blue('───────────────────────────────────'));
  console.log(chalk.blue('Signature Status'));
  console.log(chalk.blue('───────────────────────────────────\n'));

  console.log(`Files:              ${stats.files}`);
  console.log(`Structs covered:    ${stats.structs}`);
  console.log(`Total signatures:   ${stats.signatures}`);
  console.log(`Average confidence: ${stats.avgConfidence}%`);
  console.log(chalk.green(`High confidence:    ${stats.highConfidence} (≥90%)`));
  console.log(chalk.red(`Low confidence:     ${stats.lowConfidence} (<70%)`));

  console.log(chalk.blue('\nBy Type:'));
  for (const [type, count] of Object.entries(stats.byType)) {
    console.log(`  ${type}: ${count}`);
  }

  // Show structs with lowest coverage
  structList.sort((a, b) => a.avgConf - b.avgConf);
  const lowCoverageStructs = structList.filter((s) => s.avgConf < 80).slice(0, 10);

  if (lowCoverageStructs.length > 0) {
    console.log(chalk.blue('\nStructs with low confidence:'));
    for (const s of lowCoverageStructs) {
      console.log(chalk.yellow(`  ${s.name}: ${s.sigCount} sigs, ${s.avgConf}% avg`));
    }
  }
}

// ============================================================================
// Command Registration
// ============================================================================

export function createSigCommand(): Command {
  const cmd = new Command('sig')
    .description('Signature-based automatic offset discovery');

  cmd
    .command('extract')
    .description('Extract signatures from binary based on YAML definitions')
    .argument('<binary>', 'Path to game binary (ffxiv_dx11.exe)')
    .argument('<yaml-patterns...>', 'YAML file paths or glob patterns')
    .option('-o, --output <path>', 'Output file path (default: individual .sigs.yaml files)')
    .option('-v, --version <version>', 'Version identifier (auto-detected if not specified)')
    .option('--min-confidence <n>', 'Minimum confidence threshold (default: 70)')
    .option('--json', 'Output as JSON')
    .action(async (binary: string, yamlPatterns: string[], options: SigExtractOptions) => {
      await runSigExtract(binary, yamlPatterns, options);
    });

  cmd
    .command('scan')
    .description('Scan a new binary for signature matches and detect changes')
    .argument('<binary>', 'Path to new game binary')
    .option('-s, --sigs <patterns...>', 'Signature file paths or glob patterns')
    .option('-o, --output <path>', 'Output file path for results')
    .option('--min-confidence <n>', 'Minimum confidence to report (default: 0)')
    .option('--json', 'Output as JSON')
    .action(async (binary: string, options: SigScanOptions) => {
      await runSigScan(binary, options);
    });

  cmd
    .command('status')
    .description('Report signature health and coverage')
    .argument('[patterns...]', 'Signature file paths or glob patterns')
    .option('--json', 'Output as JSON')
    .action(async (patterns: string[], options: SigStatusOptions) => {
      await runSigStatus(patterns, options);
    });

  return cmd;
}
