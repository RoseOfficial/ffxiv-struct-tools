/**
 * YAML parser for FFXIVClientStructs format
 */

import { readFileSync } from 'node:fs';
import yaml from 'js-yaml';
import type { YamlData, YamlStruct, YamlEnum } from './types.js';

export interface ParsedFile {
  path: string;
  data: YamlData;
  structs: YamlStruct[];
  enums: YamlEnum[];
}

/**
 * Parse a single YAML file
 */
export function parseYamlFile(filePath: string): ParsedFile {
  const content = readFileSync(filePath, 'utf-8');
  const data = yaml.load(content) as YamlData;

  // Separate structs and enums from the combined format
  const structs: YamlStruct[] = [];
  const enums: YamlEnum[] = [];

  // Handle the standard FFXIVClientStructs format with top-level structs/enums arrays
  if (data && typeof data === 'object') {
    if (Array.isArray(data.structs)) {
      structs.push(...data.structs);
    }
    if (Array.isArray(data.enums)) {
      enums.push(...data.enums);
    }
  }

  // Some files might have a flat list of types - need to classify them
  if (Array.isArray(data)) {
    for (const item of data as unknown[]) {
      const typed = item as { type?: string; values?: unknown; fields?: unknown };
      if (typed.values && !typed.fields) {
        enums.push(typed as YamlEnum);
      } else if (typed.type) {
        structs.push(typed as YamlStruct);
      }
    }
  }

  return {
    path: filePath,
    data,
    structs,
    enums,
  };
}

/**
 * Parse multiple YAML files
 */
export function parseYamlFiles(filePaths: string[]): ParsedFile[] {
  return filePaths.map(parseYamlFile);
}

/**
 * Get all struct names from parsed files (for reference validation)
 */
export function getAllStructNames(files: ParsedFile[]): Set<string> {
  const names = new Set<string>();
  for (const file of files) {
    for (const struct of file.structs) {
      if (struct.type) {
        names.add(struct.type);
      }
    }
  }
  return names;
}

/**
 * Get all enum names from parsed files
 */
export function getAllEnumNames(files: ParsedFile[]): Set<string> {
  const names = new Set<string>();
  for (const file of files) {
    for (const enumDef of file.enums) {
      if (enumDef.type) {
        names.add(enumDef.type);
      }
    }
  }
  return names;
}
