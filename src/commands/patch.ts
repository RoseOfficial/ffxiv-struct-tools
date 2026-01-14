/**
 * patch command - Generate and apply offset patches
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { glob } from 'glob';
import chalk from 'chalk';
import yaml from 'js-yaml';
import { parseYamlFile, parseYamlFiles, type ParsedFile } from '../lib/yaml-parser.js';
import {
  applyPatchSet,
  deserializePatchSet,
  formatApplyResult,
  createOffsetShiftPatch,
  createVFuncShiftPatch,
  type PatchSet,
  type Patch,
} from '../lib/patch-engine.js';
import {
  diffStructs,
  detectHierarchyDeltas,
} from '../lib/diff-engine.js';
import {
  generateManifest,
  manifestToPatchSet,
  serializeManifest,
  deserializeManifest,
  formatManifestSummary,
  formatCandidateDetails,
  type PatchManifest,
} from '../lib/patch-manifest.js';
import { parseOffset, toHex } from '../lib/types.js';
import type { YamlData } from '../lib/types.js';

export interface PatchOptions {
  struct?: string;
  delta?: string;
  vfuncDelta?: string;
  startOffset?: string;
  startSlot?: string;
  dryRun?: boolean;
  apply?: string;
  output?: string;
  json?: boolean;
  // Auto-detect options
  autoDetect?: boolean;
  old?: string;
  new?: string;
  manifest?: string;
  minConfidence?: string;
  preview?: boolean;
}

/**
 * Run the patch command
 */
export async function runPatch(
  patterns: string[],
  options: PatchOptions
): Promise<void> {
  // Mode 1: Auto-detect deltas from two directories
  if (options.autoDetect) {
    await autoDetectDeltas(options);
    return;
  }

  // Mode 2: Apply a manifest file
  if (options.manifest) {
    await applyManifestFile(patterns, options);
    return;
  }

  // Mode 3: Apply a patch file
  if (options.apply) {
    await applyPatchFile(patterns, options);
    return;
  }

  // Mode 4: Generate and optionally apply inline patch
  await generateAndApplyPatch(patterns, options);
}

// ============================================================================
// Auto-Detect Mode
// ============================================================================

/**
 * Auto-detect offset deltas between old and new YAML directories
 */
async function autoDetectDeltas(options: PatchOptions): Promise<void> {
  if (!options.old || !options.new) {
    console.error(chalk.red('Auto-detect mode requires both --old and --new options'));
    console.log(chalk.gray('Usage: ffxiv-struct-tools patch --auto-detect --old <path> --new <path>'));
    process.exit(1);
  }

  console.log(chalk.blue('Auto-detecting offset deltas...'));
  console.log(chalk.gray(`  Old: ${options.old}`));
  console.log(chalk.gray(`  New: ${options.new}`));
  console.log();

  // Load old YAML files
  const oldPatterns = options.old.includes('*') ? [options.old] : [`${options.old}/**/*.yml`, `${options.old}/**/*.yaml`];
  const oldFiles = await expandPatterns(oldPatterns, true);
  const oldParsed = parseYamlFiles(oldFiles);
  const oldStructs = oldParsed.flatMap(f => f.structs);

  console.log(chalk.gray(`  Loaded ${oldStructs.length} structs from old version`));

  // Load new YAML files
  const newPatterns = options.new.includes('*') ? [options.new] : [`${options.new}/**/*.yml`, `${options.new}/**/*.yaml`];
  const newFiles = await expandPatterns(newPatterns, true);
  const newParsed = parseYamlFiles(newFiles);
  const newStructs = newParsed.flatMap(f => f.structs);

  console.log(chalk.gray(`  Loaded ${newStructs.length} structs from new version`));
  console.log();

  // Compute diff
  const structDiffs = diffStructs(oldStructs, newStructs);
  const modifiedCount = structDiffs.filter(d => d.type === 'modified').length;

  if (modifiedCount === 0) {
    console.log(chalk.yellow('No modified structs found between versions.'));
    return;
  }

  console.log(chalk.blue(`Found ${modifiedCount} modified structs`));
  console.log();

  // Detect hierarchy deltas
  const candidates = detectHierarchyDeltas(oldStructs, newStructs, structDiffs);

  if (candidates.length === 0) {
    console.log(chalk.yellow('No offset shift patterns detected.'));
    console.log(chalk.gray('This might mean changes are not systematic bulk shifts.'));
    return;
  }

  // Generate manifest
  const manifest = generateManifest(candidates, options.old, options.new);

  // Display summary
  console.log(formatManifestSummary(manifest));

  // Save manifest if output specified
  if (options.output) {
    const manifestJson = serializeManifest(manifest);
    writeFileSync(options.output, manifestJson, 'utf-8');
    console.log(chalk.green(`✓ Manifest saved to ${options.output}`));
    console.log(chalk.gray(`  Use: ffxiv-struct-tools patch --manifest ${options.output} <files>`));
  }

  // Show preview if requested
  if (options.preview) {
    console.log();
    console.log(chalk.blue('=== Detailed Preview ==='));
    console.log();

    for (const candidate of manifest.candidates) {
      if (candidate.enabled) {
        console.log(formatCandidateDetails(candidate));
        console.log();
      }
    }
  }

  // Output JSON if requested
  if (options.json) {
    console.log(JSON.stringify(manifest, null, 2));
  }
}

/**
 * Apply patches from a manifest file
 */
async function applyManifestFile(
  patterns: string[],
  options: PatchOptions
): Promise<void> {
  if (!existsSync(options.manifest!)) {
    console.error(chalk.red(`Manifest file not found: ${options.manifest}`));
    process.exit(1);
  }

  const manifestContent = readFileSync(options.manifest!, 'utf-8');
  let manifest: PatchManifest;

  try {
    manifest = deserializeManifest(manifestContent);
  } catch (error) {
    console.error(chalk.red('Failed to parse manifest file:'), error);
    process.exit(1);
  }

  console.log(chalk.blue(`Applying manifest: ${manifest.oldSource} → ${manifest.newSource}`));
  console.log(chalk.gray(`Generated: ${manifest.generatedAt}`));
  console.log();

  // Convert manifest to patch set
  const minConfidence = options.minConfidence ? parseFloat(options.minConfidence) : 0;
  const patchSet = manifestToPatchSet(manifest, { minConfidence });

  if (patchSet.patches.length === 0) {
    console.log(chalk.yellow('No patches to apply (all candidates disabled or below confidence threshold).'));
    return;
  }

  console.log(chalk.blue(`Applying ${patchSet.patches.length} patches...`));
  console.log();

  // Expand file patterns
  const filePaths = await expandPatterns(patterns);

  // Process each file
  for (const filePath of filePaths) {
    await processPatchForFile(filePath, patchSet, options);
  }
}

/**
 * Apply patches from a patch file
 */
async function applyPatchFile(
  patterns: string[],
  options: PatchOptions
): Promise<void> {
  // Read patch file
  if (!existsSync(options.apply!)) {
    console.error(chalk.red(`Patch file not found: ${options.apply}`));
    process.exit(1);
  }

  const patchContent = readFileSync(options.apply!, 'utf-8');
  let patchSet: PatchSet;

  try {
    patchSet = deserializePatchSet(patchContent);
  } catch (error) {
    console.error(chalk.red('Failed to parse patch file:'), error);
    process.exit(1);
  }

  console.log(chalk.blue(`Applying patch: ${patchSet.name}`));
  if (patchSet.description) {
    console.log(chalk.gray(patchSet.description));
  }
  console.log();

  // Expand file patterns
  const filePaths = await expandPatterns(patterns);

  // Process each file
  for (const filePath of filePaths) {
    await processPatchForFile(filePath, patchSet, options);
  }
}

/**
 * Generate patches from command-line options and apply them
 */
async function generateAndApplyPatch(
  patterns: string[],
  options: PatchOptions
): Promise<void> {
  const patches: Patch[] = [];

  // Build patch from options
  if (options.delta) {
    const delta = parseOffset(options.delta);
    const startOffset = options.startOffset ? parseOffset(options.startOffset) : 0;
    const structPattern = options.struct || '*';

    patches.push(createOffsetShiftPatch(structPattern, startOffset, delta));

    const sign = delta > 0 ? '+' : '';
    console.log(chalk.blue(`Creating offset patch: ${sign}${toHex(delta)} from ${toHex(startOffset)}`));
    if (options.struct) {
      console.log(chalk.gray(`  Struct pattern: ${options.struct}`));
    }
  }

  if (options.vfuncDelta) {
    const delta = parseInt(options.vfuncDelta, 10);
    const startSlot = options.startSlot ? parseInt(options.startSlot, 10) : 0;
    const structPattern = options.struct || '*';

    patches.push(createVFuncShiftPatch(structPattern, startSlot, delta));

    const sign = delta > 0 ? '+' : '';
    console.log(chalk.blue(`Creating vfunc patch: ${sign}${delta} slots from slot ${startSlot}`));
  }

  if (patches.length === 0) {
    console.error(chalk.red('No patch operations specified.'));
    console.log(chalk.gray('Use --delta <offset> for offset shifts, --vfunc-delta <n> for vtable shifts'));
    console.log(chalk.gray('Or use --apply <file> to apply a patch file'));
    process.exit(1);
  }

  const patchSet: PatchSet = {
    name: 'CLI-generated patch',
    patches,
  };

  console.log();

  // Expand file patterns
  const filePaths = await expandPatterns(patterns);

  // Process each file
  for (const filePath of filePaths) {
    await processPatchForFile(filePath, patchSet, options);
  }
}

/**
 * Process a single file with the patch set
 */
async function processPatchForFile(
  filePath: string,
  patchSet: PatchSet,
  options: PatchOptions
): Promise<void> {
  // Parse the file
  let parsed: ParsedFile;
  try {
    parsed = parseYamlFile(filePath);
  } catch (error) {
    console.error(chalk.red(`Failed to parse ${filePath}:`), error);
    return;
  }

  // Apply patches
  const { structs, enums, result } = applyPatchSet(
    parsed.structs,
    parsed.enums,
    patchSet
  );

  // Report results
  console.log(chalk.cyan(filePath));

  if (result.structsModified === 0 && result.enumsModified === 0) {
    console.log(chalk.gray('  No changes'));
    return;
  }

  // Show what changed
  for (const [name, changes] of result.details) {
    console.log(chalk.yellow(`  ${name}:`));
    for (const change of changes) {
      console.log(chalk.white(`    ${change}`));
    }
  }

  if (options.dryRun) {
    console.log(chalk.magenta('  [dry-run] Changes not written'));
    return;
  }

  // Write the modified file
  const outputPath = options.output || filePath;

  // Reconstruct the YAML data
  const newData: YamlData = {
    ...parsed.data,
    structs: structs.length > 0 ? structs : undefined,
    enums: enums.length > 0 ? enums : undefined,
  };

  // Clean up undefined properties
  if (!newData.structs) delete newData.structs;
  if (!newData.enums) delete newData.enums;

  try {
    const yamlOutput = yaml.dump(newData, {
      indent: 2,
      lineWidth: -1, // Don't wrap lines
      noRefs: true,
      sortKeys: false,
    });

    writeFileSync(outputPath, yamlOutput, 'utf-8');
    console.log(chalk.green(`  ✓ Written to ${outputPath}`));
  } catch (error) {
    console.error(chalk.red(`  Failed to write ${outputPath}:`), error);
  }
}

/**
 * Expand glob patterns to file paths
 */
async function expandPatterns(patterns: string[], quiet = false): Promise<string[]> {
  const filePaths: string[] = [];

  for (const pattern of patterns) {
    const matches = await glob(pattern, { nodir: true });
    filePaths.push(...matches);
  }

  if (filePaths.length === 0) {
    if (!quiet) {
      console.error(chalk.red('No files found matching the provided patterns'));
      process.exit(1);
    }
    return [];
  }

  if (!quiet) {
    console.log(chalk.blue(`Processing ${filePaths.length} file(s)...\n`));
  }

  return filePaths;
}
