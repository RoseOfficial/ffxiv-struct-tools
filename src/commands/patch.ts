/**
 * patch command - Generate and apply offset patches
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { glob } from 'glob';
import chalk from 'chalk';
import yaml from 'js-yaml';
import { parseYamlFile, type ParsedFile } from '../lib/yaml-parser.js';
import {
  applyPatchSet,
  deserializePatchSet,
  formatApplyResult,
  createOffsetShiftPatch,
  createVFuncShiftPatch,
  type PatchSet,
  type Patch,
} from '../lib/patch-engine.js';
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
}

/**
 * Run the patch command
 */
export async function runPatch(
  patterns: string[],
  options: PatchOptions
): Promise<void> {
  // Mode 1: Apply a patch file
  if (options.apply) {
    await applyPatchFile(patterns, options);
    return;
  }

  // Mode 2: Generate and optionally apply inline patch
  await generateAndApplyPatch(patterns, options);
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
async function expandPatterns(patterns: string[]): Promise<string[]> {
  const filePaths: string[] = [];

  for (const pattern of patterns) {
    const matches = await glob(pattern, { nodir: true });
    filePaths.push(...matches);
  }

  if (filePaths.length === 0) {
    console.error(chalk.red('No files found matching the provided patterns'));
    process.exit(1);
  }

  console.log(chalk.blue(`Processing ${filePaths.length} file(s)...\n`));

  return filePaths;
}
