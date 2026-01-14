/**
 * Version store for tracking struct evolution across game versions
 * Stores snapshots in .ffxiv-struct-versions/ directory
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join, basename, dirname } from 'node:path';
import { createGzip, gunzipSync } from 'node:zlib';
import yaml from 'js-yaml';
import type { YamlStruct, YamlEnum } from './types.js';

// ============================================================================
// Types
// ============================================================================

export interface VersionMetadata {
  /** Version identifier (e.g., "7.0", "6.5") */
  version: string;
  /** When this snapshot was created */
  createdAt: string;
  /** Game version or patch number */
  gameVersion?: string;
  /** User-provided notes */
  notes?: string;
  /** Source path(s) used to create this snapshot */
  sourcePaths: string[];
  /** Number of structs in snapshot */
  structCount: number;
  /** Number of enums in snapshot */
  enumCount: number;
}

export interface VersionSnapshot {
  /** Metadata about this version */
  metadata: VersionMetadata;
  /** Struct definitions */
  structs: YamlStruct[];
  /** Enum definitions */
  enums: YamlEnum[];
}

export interface VersionSummary {
  version: string;
  createdAt: string;
  gameVersion?: string;
  notes?: string;
  structCount: number;
  enumCount: number;
}

export interface StructHistory {
  structName: string;
  history: {
    version: string;
    createdAt: string;
    size?: number;
    fieldCount: number;
    funcCount: number;
    vfuncCount: number;
  }[];
}

// ============================================================================
// Store Management
// ============================================================================

const STORE_DIR = '.ffxiv-struct-versions';
const METADATA_FILE = 'versions.json';

/**
 * Get the versions store directory path
 */
export function getStoreDir(basePath: string = process.cwd()): string {
  return join(basePath, STORE_DIR);
}

/**
 * Ensure the versions store directory exists
 */
export function ensureStoreDir(basePath: string = process.cwd()): string {
  const storeDir = getStoreDir(basePath);
  if (!existsSync(storeDir)) {
    mkdirSync(storeDir, { recursive: true });
  }
  return storeDir;
}

/**
 * Get path to a version snapshot file
 */
function getSnapshotPath(storeDir: string, version: string): string {
  // Sanitize version for use as filename
  const safeVersion = version.replace(/[^a-zA-Z0-9.-]/g, '_');
  return join(storeDir, `${safeVersion}.json.gz`);
}

/**
 * Get path to metadata file
 */
function getMetadataPath(storeDir: string): string {
  return join(storeDir, METADATA_FILE);
}

// ============================================================================
// Version Operations
// ============================================================================

/**
 * Save a new version snapshot
 */
export function saveVersion(
  version: string,
  structs: YamlStruct[],
  enums: YamlEnum[],
  options: {
    basePath?: string;
    gameVersion?: string;
    notes?: string;
    sourcePaths?: string[];
  } = {}
): VersionMetadata {
  const storeDir = ensureStoreDir(options.basePath);

  // Check if version already exists
  const existing = listVersions(options.basePath);
  if (existing.some(v => v.version === version)) {
    throw new Error(`Version "${version}" already exists. Use a different version name or delete the existing one.`);
  }

  // Create metadata
  const metadata: VersionMetadata = {
    version,
    createdAt: new Date().toISOString(),
    gameVersion: options.gameVersion,
    notes: options.notes,
    sourcePaths: options.sourcePaths || [],
    structCount: structs.length,
    enumCount: enums.length,
  };

  // Create snapshot
  const snapshot: VersionSnapshot = {
    metadata,
    structs,
    enums,
  };

  // Write compressed snapshot
  const snapshotPath = getSnapshotPath(storeDir, version);
  const jsonContent = JSON.stringify(snapshot);
  const compressed = require('zlib').gzipSync(jsonContent);
  writeFileSync(snapshotPath, compressed);

  // Update metadata index
  updateMetadataIndex(storeDir, metadata);

  return metadata;
}

/**
 * Load a version snapshot
 */
export function loadVersion(
  version: string,
  basePath: string = process.cwd()
): VersionSnapshot | null {
  const storeDir = getStoreDir(basePath);
  const snapshotPath = getSnapshotPath(storeDir, version);

  if (!existsSync(snapshotPath)) {
    return null;
  }

  try {
    const compressed = readFileSync(snapshotPath);
    const jsonContent = gunzipSync(compressed).toString('utf-8');
    return JSON.parse(jsonContent) as VersionSnapshot;
  } catch {
    return null;
  }
}

/**
 * Delete a version snapshot
 */
export function deleteVersion(
  version: string,
  basePath: string = process.cwd()
): boolean {
  const storeDir = getStoreDir(basePath);
  const snapshotPath = getSnapshotPath(storeDir, version);

  if (!existsSync(snapshotPath)) {
    return false;
  }

  rmSync(snapshotPath);

  // Update metadata index
  removeFromMetadataIndex(storeDir, version);

  return true;
}

/**
 * List all saved versions
 */
export function listVersions(basePath: string = process.cwd()): VersionSummary[] {
  const storeDir = getStoreDir(basePath);
  const metadataPath = getMetadataPath(storeDir);

  if (!existsSync(metadataPath)) {
    return [];
  }

  try {
    const content = readFileSync(metadataPath, 'utf-8');
    const index = JSON.parse(content) as { versions: VersionMetadata[] };
    return index.versions.map(m => ({
      version: m.version,
      createdAt: m.createdAt,
      gameVersion: m.gameVersion,
      notes: m.notes,
      structCount: m.structCount,
      enumCount: m.enumCount,
    }));
  } catch {
    return [];
  }
}

/**
 * Get history for a specific struct across all versions
 */
export function getStructHistory(
  structName: string,
  basePath: string = process.cwd()
): StructHistory {
  const versions = listVersions(basePath);
  const history: StructHistory['history'] = [];

  for (const versionSummary of versions) {
    const snapshot = loadVersion(versionSummary.version, basePath);
    if (!snapshot) continue;

    const struct = snapshot.structs.find(s => s.type === structName);
    if (struct) {
      history.push({
        version: versionSummary.version,
        createdAt: versionSummary.createdAt,
        size: struct.size,
        fieldCount: struct.fields?.length || 0,
        funcCount: struct.funcs?.length || 0,
        vfuncCount: struct.vfuncs?.length || 0,
      });
    }
  }

  // Sort by date (oldest first)
  history.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

  return {
    structName,
    history,
  };
}

// ============================================================================
// Metadata Index Management
// ============================================================================

/**
 * Update the metadata index with a new version
 */
function updateMetadataIndex(storeDir: string, metadata: VersionMetadata): void {
  const metadataPath = getMetadataPath(storeDir);
  let index: { versions: VersionMetadata[] } = { versions: [] };

  if (existsSync(metadataPath)) {
    try {
      const content = readFileSync(metadataPath, 'utf-8');
      index = JSON.parse(content);
    } catch {
      // Start fresh if corrupted
    }
  }

  // Add new version
  index.versions.push(metadata);

  // Sort by date (newest first for listing)
  index.versions.sort((a, b) =>
    new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );

  writeFileSync(metadataPath, JSON.stringify(index, null, 2), 'utf-8');
}

/**
 * Remove a version from the metadata index
 */
function removeFromMetadataIndex(storeDir: string, version: string): void {
  const metadataPath = getMetadataPath(storeDir);

  if (!existsSync(metadataPath)) {
    return;
  }

  try {
    const content = readFileSync(metadataPath, 'utf-8');
    const index = JSON.parse(content) as { versions: VersionMetadata[] };

    index.versions = index.versions.filter(v => v.version !== version);

    writeFileSync(metadataPath, JSON.stringify(index, null, 2), 'utf-8');
  } catch {
    // Ignore errors
  }
}

// ============================================================================
// Changelog Generation
// ============================================================================

export interface VersionChangelog {
  fromVersion: string;
  toVersion: string;
  structsAdded: string[];
  structsRemoved: string[];
  structsModified: {
    name: string;
    sizeChange?: { old: number; new: number };
    fieldsAdded: number;
    fieldsRemoved: number;
    fieldsModified: number;
  }[];
  enumsAdded: string[];
  enumsRemoved: string[];
  enumsModified: string[];
}

/**
 * Generate a changelog between two versions
 */
export function generateChangelog(
  fromVersion: string,
  toVersion: string,
  basePath: string = process.cwd()
): VersionChangelog | null {
  const fromSnapshot = loadVersion(fromVersion, basePath);
  const toSnapshot = loadVersion(toVersion, basePath);

  if (!fromSnapshot || !toSnapshot) {
    return null;
  }

  const fromStructMap = new Map(fromSnapshot.structs.map(s => [s.type, s]));
  const toStructMap = new Map(toSnapshot.structs.map(s => [s.type, s]));

  const fromEnumMap = new Map(fromSnapshot.enums.map(e => [e.type, e]));
  const toEnumMap = new Map(toSnapshot.enums.map(e => [e.type, e]));

  // Find struct changes
  const structsAdded: string[] = [];
  const structsRemoved: string[] = [];
  const structsModified: VersionChangelog['structsModified'] = [];

  for (const [name, struct] of toStructMap) {
    if (!fromStructMap.has(name)) {
      structsAdded.push(name);
    } else {
      const oldStruct = fromStructMap.get(name)!;
      const changes = compareStructForChangelog(oldStruct, struct);
      if (changes) {
        structsModified.push({ name, ...changes });
      }
    }
  }

  for (const name of fromStructMap.keys()) {
    if (!toStructMap.has(name)) {
      structsRemoved.push(name);
    }
  }

  // Find enum changes
  const enumsAdded: string[] = [];
  const enumsRemoved: string[] = [];
  const enumsModified: string[] = [];

  for (const name of toEnumMap.keys()) {
    if (!fromEnumMap.has(name)) {
      enumsAdded.push(name);
    } else {
      const oldEnum = fromEnumMap.get(name)!;
      const newEnum = toEnumMap.get(name)!;
      if (JSON.stringify(oldEnum) !== JSON.stringify(newEnum)) {
        enumsModified.push(name);
      }
    }
  }

  for (const name of fromEnumMap.keys()) {
    if (!toEnumMap.has(name)) {
      enumsRemoved.push(name);
    }
  }

  return {
    fromVersion,
    toVersion,
    structsAdded,
    structsRemoved,
    structsModified,
    enumsAdded,
    enumsRemoved,
    enumsModified,
  };
}

/**
 * Compare two structs for changelog
 */
function compareStructForChangelog(
  oldStruct: YamlStruct,
  newStruct: YamlStruct
): Omit<VersionChangelog['structsModified'][0], 'name'> | null {
  const oldFields = new Set((oldStruct.fields || []).map(f => f.name || `offset_${f.offset}`));
  const newFields = new Set((newStruct.fields || []).map(f => f.name || `offset_${f.offset}`));

  const fieldsAdded = [...newFields].filter(f => !oldFields.has(f)).length;
  const fieldsRemoved = [...oldFields].filter(f => !newFields.has(f)).length;

  // Count modified fields (same name, different properties)
  let fieldsModified = 0;
  for (const newField of newStruct.fields || []) {
    const fieldKey = newField.name || `offset_${newField.offset}`;
    if (oldFields.has(fieldKey)) {
      const oldField = (oldStruct.fields || []).find(f =>
        (f.name || `offset_${f.offset}`) === fieldKey
      );
      if (oldField && JSON.stringify(oldField) !== JSON.stringify(newField)) {
        fieldsModified++;
      }
    }
  }

  const sizeChanged = oldStruct.size !== newStruct.size;

  if (!sizeChanged && fieldsAdded === 0 && fieldsRemoved === 0 && fieldsModified === 0) {
    return null;
  }

  return {
    sizeChange: sizeChanged ? { old: oldStruct.size || 0, new: newStruct.size || 0 } : undefined,
    fieldsAdded,
    fieldsRemoved,
    fieldsModified,
  };
}
