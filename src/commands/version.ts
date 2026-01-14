/**
 * version command - Track struct evolution across game versions
 */

import { glob } from 'glob';
import chalk from 'chalk';
import { parseYamlFiles } from '../lib/yaml-parser.js';
import {
  saveVersion,
  loadVersion,
  deleteVersion,
  listVersions,
  getStructHistory,
  generateChangelog,
  getStoreDir,
  type VersionSnapshot,
  type VersionSummary,
  type StructHistory,
  type VersionChangelog,
} from '../lib/version-store.js';
import { toHex } from '../lib/types.js';

export interface VersionOptions {
  path?: string;
  notes?: string;
  gameVersion?: string;
  json?: boolean;
  force?: boolean;
}

// ============================================================================
// Subcommand Handlers
// ============================================================================

/**
 * Save a new version snapshot
 */
export async function runVersionSave(
  version: string,
  options: VersionOptions
): Promise<void> {
  const patterns = options.path
    ? (options.path.includes('*') ? [options.path] : [`${options.path}/**/*.yml`, `${options.path}/**/*.yaml`])
    : ['**/*.yml', '**/*.yaml'];

  console.log(chalk.blue(`Saving version "${version}"...`));

  // Expand patterns and parse files
  const filePaths: string[] = [];
  for (const pattern of patterns) {
    const matches = await glob(pattern, { nodir: true, ignore: ['node_modules/**', '.ffxiv-struct-versions/**'] });
    filePaths.push(...matches);
  }

  if (filePaths.length === 0) {
    console.error(chalk.red('No YAML files found'));
    process.exit(1);
  }

  console.log(chalk.gray(`  Found ${filePaths.length} YAML files`));

  const parsed = parseYamlFiles(filePaths);
  const structs = parsed.flatMap(f => f.structs);
  const enums = parsed.flatMap(f => f.enums);

  console.log(chalk.gray(`  ${structs.length} structs, ${enums.length} enums`));

  try {
    const metadata = saveVersion(version, structs, enums, {
      gameVersion: options.gameVersion,
      notes: options.notes,
      sourcePaths: filePaths,
    });

    console.log();
    console.log(chalk.green(`✓ Version "${version}" saved successfully`));
    console.log(chalk.gray(`  Store: ${getStoreDir()}`));
    console.log(chalk.gray(`  Structs: ${metadata.structCount}`));
    console.log(chalk.gray(`  Enums: ${metadata.enumCount}`));
    if (metadata.notes) {
      console.log(chalk.gray(`  Notes: ${metadata.notes}`));
    }
  } catch (error) {
    console.error(chalk.red(`Failed to save version: ${error}`));
    process.exit(1);
  }
}

/**
 * List all saved versions
 */
export async function runVersionList(options: VersionOptions): Promise<void> {
  const versions = listVersions();

  if (versions.length === 0) {
    console.log(chalk.yellow('No versions saved yet.'));
    console.log(chalk.gray('Use: ffxiv-struct-tools version save <version> --path <yaml-dir>'));
    return;
  }

  if (options.json) {
    console.log(JSON.stringify(versions, null, 2));
    return;
  }

  console.log(chalk.blue.bold('Saved Versions'));
  console.log(chalk.blue('═══════════════════════════════════════════════════════════'));
  console.log();

  for (const v of versions) {
    const date = new Date(v.createdAt).toLocaleString();
    console.log(chalk.cyan.bold(`  ${v.version}`));
    console.log(chalk.white(`  ├─ Created: ${date}`));
    console.log(chalk.white(`  ├─ Structs: ${v.structCount}, Enums: ${v.enumCount}`));
    if (v.gameVersion) {
      console.log(chalk.white(`  ├─ Game Version: ${v.gameVersion}`));
    }
    if (v.notes) {
      console.log(chalk.white(`  └─ Notes: ${v.notes}`));
    } else {
      console.log(chalk.white(`  └─`));
    }
    console.log();
  }

  console.log(chalk.gray(`Total: ${versions.length} version(s)`));
}

/**
 * Show version diff/changelog
 */
export async function runVersionDiff(
  fromVersion: string,
  toVersion: string,
  options: VersionOptions
): Promise<void> {
  const changelog = generateChangelog(fromVersion, toVersion);

  if (!changelog) {
    console.error(chalk.red('Failed to generate changelog. Make sure both versions exist.'));
    console.log(chalk.gray('Use: ffxiv-struct-tools version list'));
    process.exit(1);
  }

  if (options.json) {
    console.log(JSON.stringify(changelog, null, 2));
    return;
  }

  printChangelog(changelog);
}

/**
 * Show history for a specific struct
 */
export async function runVersionHistory(
  structName: string,
  options: VersionOptions
): Promise<void> {
  const history = getStructHistory(structName);

  if (history.history.length === 0) {
    console.log(chalk.yellow(`Struct "${structName}" not found in any saved version.`));
    return;
  }

  if (options.json) {
    console.log(JSON.stringify(history, null, 2));
    return;
  }

  console.log(chalk.blue.bold(`History: ${structName}`));
  console.log(chalk.blue('═══════════════════════════════════════════════════════════'));
  console.log();

  let prevSize: number | undefined;

  for (const entry of history.history) {
    const date = new Date(entry.createdAt).toLocaleDateString();

    console.log(chalk.cyan.bold(`  ${entry.version}`) + chalk.gray(` (${date})`));

    if (entry.size !== undefined) {
      let sizeStr = `Size: ${toHex(entry.size)}`;
      if (prevSize !== undefined && entry.size !== prevSize) {
        const delta = entry.size - prevSize;
        const sign = delta > 0 ? '+' : '';
        sizeStr += chalk.yellow(` (${sign}${toHex(delta)})`);
      }
      console.log(chalk.white(`  ├─ ${sizeStr}`));
      prevSize = entry.size;
    }

    console.log(chalk.white(`  ├─ Fields: ${entry.fieldCount}`));
    console.log(chalk.white(`  ├─ Funcs: ${entry.funcCount}`));
    console.log(chalk.white(`  └─ VFuncs: ${entry.vfuncCount}`));
    console.log();
  }
}

/**
 * Delete a version
 */
export async function runVersionDelete(
  version: string,
  options: VersionOptions
): Promise<void> {
  if (!options.force) {
    console.log(chalk.yellow(`About to delete version "${version}"`));
    console.log(chalk.gray('Use --force to confirm deletion'));
    return;
  }

  const success = deleteVersion(version);

  if (success) {
    console.log(chalk.green(`✓ Version "${version}" deleted`));
  } else {
    console.error(chalk.red(`Version "${version}" not found`));
    process.exit(1);
  }
}

// ============================================================================
// Display Helpers
// ============================================================================

/**
 * Print changelog in human-readable format
 */
function printChangelog(changelog: VersionChangelog): void {
  console.log(chalk.blue.bold(`Changelog: ${changelog.fromVersion} → ${changelog.toVersion}`));
  console.log(chalk.blue('═══════════════════════════════════════════════════════════'));
  console.log();

  // Structs added
  if (changelog.structsAdded.length > 0) {
    console.log(chalk.green.bold(`Added Structs (${changelog.structsAdded.length})`));
    console.log(chalk.green('───────────────────────────────────────────────────────────'));
    for (const name of changelog.structsAdded) {
      console.log(chalk.green(`  + ${name}`));
    }
    console.log();
  }

  // Structs removed
  if (changelog.structsRemoved.length > 0) {
    console.log(chalk.red.bold(`Removed Structs (${changelog.structsRemoved.length})`));
    console.log(chalk.red('───────────────────────────────────────────────────────────'));
    for (const name of changelog.structsRemoved) {
      console.log(chalk.red(`  - ${name}`));
    }
    console.log();
  }

  // Structs modified
  if (changelog.structsModified.length > 0) {
    console.log(chalk.yellow.bold(`Modified Structs (${changelog.structsModified.length})`));
    console.log(chalk.yellow('───────────────────────────────────────────────────────────'));
    for (const mod of changelog.structsModified) {
      const parts: string[] = [];

      if (mod.sizeChange) {
        const delta = mod.sizeChange.new - mod.sizeChange.old;
        const sign = delta > 0 ? '+' : '';
        parts.push(`size: ${toHex(mod.sizeChange.old)} → ${toHex(mod.sizeChange.new)} (${sign}${toHex(delta)})`);
      }

      if (mod.fieldsAdded > 0) parts.push(`+${mod.fieldsAdded} fields`);
      if (mod.fieldsRemoved > 0) parts.push(`-${mod.fieldsRemoved} fields`);
      if (mod.fieldsModified > 0) parts.push(`~${mod.fieldsModified} fields`);

      console.log(chalk.yellow(`  ~ ${mod.name}: ${parts.join(', ')}`));
    }
    console.log();
  }

  // Enums
  if (changelog.enumsAdded.length > 0) {
    console.log(chalk.green.bold(`Added Enums (${changelog.enumsAdded.length})`));
    for (const name of changelog.enumsAdded) {
      console.log(chalk.green(`  + ${name}`));
    }
    console.log();
  }

  if (changelog.enumsRemoved.length > 0) {
    console.log(chalk.red.bold(`Removed Enums (${changelog.enumsRemoved.length})`));
    for (const name of changelog.enumsRemoved) {
      console.log(chalk.red(`  - ${name}`));
    }
    console.log();
  }

  if (changelog.enumsModified.length > 0) {
    console.log(chalk.yellow.bold(`Modified Enums (${changelog.enumsModified.length})`));
    for (const name of changelog.enumsModified) {
      console.log(chalk.yellow(`  ~ ${name}`));
    }
    console.log();
  }

  // Summary
  const totalChanges =
    changelog.structsAdded.length +
    changelog.structsRemoved.length +
    changelog.structsModified.length +
    changelog.enumsAdded.length +
    changelog.enumsRemoved.length +
    changelog.enumsModified.length;

  console.log(chalk.blue('───────────────────────────────────────────────────────────'));
  console.log(chalk.white(`Summary: ${totalChanges} total changes`));
  console.log(chalk.white(`  Structs: +${changelog.structsAdded.length} -${changelog.structsRemoved.length} ~${changelog.structsModified.length}`));
  console.log(chalk.white(`  Enums: +${changelog.enumsAdded.length} -${changelog.enumsRemoved.length} ~${changelog.enumsModified.length}`));
}
