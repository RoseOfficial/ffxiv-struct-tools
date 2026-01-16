/**
 * Bidirectional sync engine for YAML and ReClass.NET
 *
 * Handles merging changes between YAML struct definitions (source of truth for names/types)
 * and ReClass.NET files (source of truth for memory observations)
 */

import type { YamlStruct, YamlField, YamlEnum, YamlData } from './types.js';
import { parseOffset, toHex } from './types.js';

// ============================================================================
// Sync Types
// ============================================================================

export type SyncDirection = 'yaml-to-reclass' | 'reclass-to-yaml' | 'bidirectional';

export type ConflictStrategy = 'prefer-yaml' | 'prefer-reclass' | 'manual' | 'newest';

export interface SyncOptions {
  /** Direction of synchronization */
  direction: SyncDirection;
  /** Strategy for handling conflicts */
  conflictStrategy: ConflictStrategy;
  /** Whether to preserve existing field names when merging */
  preserveNames?: boolean;
  /** Whether to preserve existing type information when merging */
  preserveTypes?: boolean;
  /** Whether to preserve comments/notes */
  preserveNotes?: boolean;
  /** Minimum confidence for auto-accepting changes */
  minConfidence?: number;
}

export type ChangeType = 'added' | 'removed' | 'modified' | 'unchanged';

export interface FieldChange {
  offset: number;
  changeType: ChangeType;
  yamlField?: YamlField;
  reclassField?: YamlField;
  mergedField?: YamlField;
  conflict?: boolean;
  conflictReason?: string;
}

export interface StructChange {
  structName: string;
  changeType: ChangeType;
  yamlStruct?: YamlStruct;
  reclassStruct?: YamlStruct;
  fieldChanges: FieldChange[];
  sizeChanged: boolean;
  oldSize?: number;
  newSize?: number;
}

export interface SyncResult {
  /** Direction used */
  direction: SyncDirection;
  /** Structs that were analyzed */
  structsAnalyzed: number;
  /** Structs with changes */
  structsChanged: number;
  /** Structs added */
  structsAdded: number;
  /** Structs removed */
  structsRemoved: number;
  /** Fields that were added */
  fieldsAdded: number;
  /** Fields that were removed */
  fieldsRemoved: number;
  /** Fields that were modified */
  fieldsModified: number;
  /** Conflicts encountered */
  conflictCount: number;
  /** Detailed change information */
  changes: StructChange[];
  /** Merged result (if applicable) */
  merged?: YamlData;
  /** Conflicts that need manual resolution */
  unresolvedConflicts: FieldChange[];
}

// ============================================================================
// Field Comparison
// ============================================================================

/**
 * Compare two fields and determine what changed
 */
export function compareFields(
  yamlField: YamlField | undefined,
  reclassField: YamlField | undefined,
  options: SyncOptions
): FieldChange {
  const offset = yamlField
    ? parseOffset(yamlField.offset)
    : parseOffset(reclassField!.offset);

  // Only in YAML
  if (yamlField && !reclassField) {
    return {
      offset,
      changeType: options.direction === 'reclass-to-yaml' ? 'removed' : 'unchanged',
      yamlField,
      mergedField: options.direction === 'reclass-to-yaml' ? undefined : yamlField,
    };
  }

  // Only in ReClass
  if (!yamlField && reclassField) {
    return {
      offset,
      changeType: options.direction === 'yaml-to-reclass' ? 'removed' : 'added',
      reclassField,
      mergedField: options.direction === 'yaml-to-reclass' ? undefined : reclassField,
    };
  }

  // Both exist - compare them
  const typesDiffer = normalizeType(yamlField!.type) !== normalizeType(reclassField!.type);
  const namesDiffer = (yamlField!.name || '') !== (reclassField!.name || '');
  const sizesDiffer = (yamlField!.size || 0) !== (reclassField!.size || 0);

  if (!typesDiffer && !namesDiffer && !sizesDiffer) {
    // No changes - prefer YAML as it has more metadata
    return {
      offset,
      changeType: 'unchanged',
      yamlField,
      reclassField,
      mergedField: yamlField,
    };
  }

  // There are differences - resolve based on strategy
  const conflict = typesDiffer || (namesDiffer && !!yamlField!.name && !!reclassField!.name);

  let mergedField: YamlField;
  let conflictReason: string | undefined;

  if (conflict && options.conflictStrategy === 'manual') {
    // Mark for manual resolution
    const reasons: string[] = [];
    if (typesDiffer) reasons.push(`type: ${yamlField!.type} vs ${reclassField!.type}`);
    if (namesDiffer) reasons.push(`name: ${yamlField!.name || '(none)'} vs ${reclassField!.name || '(none)'}`);
    conflictReason = reasons.join('; ');

    return {
      offset,
      changeType: 'modified',
      yamlField,
      reclassField,
      conflict: true,
      conflictReason,
    };
  }

  // Apply merge strategy
  mergedField = mergeFields(yamlField!, reclassField!, options);

  return {
    offset,
    changeType: 'modified',
    yamlField,
    reclassField,
    mergedField,
    conflict: !!conflict,
    conflictReason: conflict ? `Auto-resolved using ${options.conflictStrategy}` : undefined,
  };
}

/**
 * Merge two fields based on the conflict strategy
 */
function mergeFields(
  yamlField: YamlField,
  reclassField: YamlField,
  options: SyncOptions
): YamlField {
  const preferYaml = options.conflictStrategy === 'prefer-yaml';
  const preferReclass = options.conflictStrategy === 'prefer-reclass';

  const merged: YamlField = {
    type: preferReclass ? reclassField.type : yamlField.type,
    offset: yamlField.offset, // Keep YAML offset format
  };

  // Name resolution
  if (options.preserveNames !== false) {
    // Prefer named fields over unnamed
    if (yamlField.name && !reclassField.name) {
      merged.name = yamlField.name;
    } else if (!yamlField.name && reclassField.name) {
      merged.name = reclassField.name;
    } else if (yamlField.name && reclassField.name) {
      merged.name = preferReclass ? reclassField.name : yamlField.name;
    }
  }

  // Type resolution
  if (options.preserveTypes !== false) {
    // Prefer more specific types
    const yamlTypeSpecificity = getTypeSpecificity(yamlField.type);
    const reclassTypeSpecificity = getTypeSpecificity(reclassField.type);

    if (!preferYaml && !preferReclass) {
      // Auto-select more specific type
      merged.type = yamlTypeSpecificity >= reclassTypeSpecificity
        ? yamlField.type
        : reclassField.type;
    }
  }

  // Size - use larger size to be safe
  if (yamlField.size || reclassField.size) {
    merged.size = Math.max(yamlField.size || 0, reclassField.size || 0) || undefined;
  }

  // Notes - merge both
  if (options.preserveNotes !== false) {
    if (yamlField.notes && reclassField.notes && yamlField.notes !== reclassField.notes) {
      merged.notes = `${yamlField.notes}\n[ReClass] ${reclassField.notes}`;
    } else {
      merged.notes = yamlField.notes || reclassField.notes;
    }
  }

  return merged;
}

/**
 * Get specificity score for a type (higher = more specific/useful)
 */
function getTypeSpecificity(type: string): number {
  // Generic/unknown types
  if (type === 'byte' || type === 'Hex8') return 1;
  if (type.startsWith('byte[') || type.startsWith('Hex')) return 2;

  // Basic numeric types
  if (['int', 'uint', 'short', 'ushort', 'long', 'ulong', 'float', 'double'].includes(type)) return 3;

  // Bool type
  if (type === 'bool') return 4;

  // Pointer types
  if (type === 'void*') return 5;
  if (type.endsWith('*')) return 8; // Typed pointer

  // Known FFXIV types
  if (type === 'Utf8String' || type === 'CString') return 7;
  if (type.startsWith('Vector') || type.startsWith('Matrix')) return 7;

  // Custom struct types (most specific)
  if (type.match(/^[A-Z]/)) return 9;

  return 3; // Default
}

/**
 * Normalize type for comparison
 */
function normalizeType(type: string): string {
  // Map equivalent types
  const normalizations: Record<string, string> = {
    'Hex8': 'byte',
    'UInt8': 'byte',
    'Int8': 'sbyte',
    'Hex16': 'ushort',
    'UInt16': 'ushort',
    'Int16': 'short',
    'Hex32': 'uint',
    'UInt32': 'uint',
    'Int32': 'int',
    'Hex64': 'ulong',
    'UInt64': 'ulong',
    'Int64': 'long',
    'Float': 'float',
    'Double': 'double',
    'Boolean': 'bool',
    'Bool': 'bool',
  };

  return normalizations[type] || type;
}

// ============================================================================
// Struct Comparison
// ============================================================================

/**
 * Compare two structs and generate change information
 */
export function compareStructs(
  yamlStruct: YamlStruct | undefined,
  reclassStruct: YamlStruct | undefined,
  options: SyncOptions
): StructChange {
  const structName = yamlStruct?.type || reclassStruct?.type || 'Unknown';

  // Only in YAML
  if (yamlStruct && !reclassStruct) {
    return {
      structName,
      changeType: options.direction === 'reclass-to-yaml' ? 'removed' : 'unchanged',
      yamlStruct,
      fieldChanges: [],
      sizeChanged: false,
    };
  }

  // Only in ReClass
  if (!yamlStruct && reclassStruct) {
    return {
      structName,
      changeType: options.direction === 'yaml-to-reclass' ? 'removed' : 'added',
      reclassStruct,
      fieldChanges: [],
      sizeChanged: false,
    };
  }

  // Both exist - compare fields
  const yamlFields = new Map<number, YamlField>();
  const reclassFields = new Map<number, YamlField>();

  for (const field of yamlStruct!.fields || []) {
    yamlFields.set(parseOffset(field.offset), field);
  }

  for (const field of reclassStruct!.fields || []) {
    reclassFields.set(parseOffset(field.offset), field);
  }

  // Get all unique offsets
  const allOffsets = new Set([...yamlFields.keys(), ...reclassFields.keys()]);
  const fieldChanges: FieldChange[] = [];

  for (const offset of Array.from(allOffsets).sort((a, b) => a - b)) {
    const change = compareFields(
      yamlFields.get(offset),
      reclassFields.get(offset),
      options
    );
    fieldChanges.push(change);
  }

  // Check for size changes
  const yamlSize = yamlStruct!.size || 0;
  const reclassSize = reclassStruct!.size || 0;
  const sizeChanged = yamlSize !== reclassSize && yamlSize > 0 && reclassSize > 0;

  // Determine overall change type
  const hasChanges = fieldChanges.some(c => c.changeType !== 'unchanged') || sizeChanged;

  return {
    structName,
    changeType: hasChanges ? 'modified' : 'unchanged',
    yamlStruct,
    reclassStruct,
    fieldChanges,
    sizeChanged,
    oldSize: yamlSize,
    newSize: reclassSize,
  };
}

// ============================================================================
// Sync Engine
// ============================================================================

/**
 * Synchronize YAML and ReClass data
 */
export function syncData(
  yamlData: YamlData,
  reclassData: YamlData,
  options: SyncOptions
): SyncResult {
  const changes: StructChange[] = [];
  const unresolvedConflicts: FieldChange[] = [];

  // Build lookup maps
  const yamlStructs = new Map<string, YamlStruct>();
  const reclassStructs = new Map<string, YamlStruct>();

  for (const struct of yamlData.structs || []) {
    yamlStructs.set(struct.type, struct);
  }

  for (const struct of reclassData.structs || []) {
    reclassStructs.set(struct.type, struct);
  }

  // Get all unique struct names
  const allStructNames = new Set([...yamlStructs.keys(), ...reclassStructs.keys()]);

  // Compare each struct
  for (const structName of allStructNames) {
    const change = compareStructs(
      yamlStructs.get(structName),
      reclassStructs.get(structName),
      options
    );
    changes.push(change);

    // Collect unresolved conflicts
    for (const fieldChange of change.fieldChanges) {
      if (fieldChange.conflict && !fieldChange.mergedField) {
        unresolvedConflicts.push(fieldChange);
      }
    }
  }

  // Calculate statistics
  let structsChanged = 0;
  let structsAdded = 0;
  let structsRemoved = 0;
  let fieldsAdded = 0;
  let fieldsRemoved = 0;
  let fieldsModified = 0;
  let conflictCount = 0;

  for (const change of changes) {
    switch (change.changeType) {
      case 'added':
        structsAdded++;
        break;
      case 'removed':
        structsRemoved++;
        break;
      case 'modified':
        structsChanged++;
        break;
    }

    for (const fieldChange of change.fieldChanges) {
      switch (fieldChange.changeType) {
        case 'added':
          fieldsAdded++;
          break;
        case 'removed':
          fieldsRemoved++;
          break;
        case 'modified':
          fieldsModified++;
          break;
      }

      if (fieldChange.conflict) {
        conflictCount++;
      }
    }
  }

  // Generate merged result if no unresolved conflicts
  let merged: YamlData | undefined;
  if (unresolvedConflicts.length === 0) {
    merged = generateMergedData(changes, yamlData, reclassData, options);
  }

  return {
    direction: options.direction,
    structsAnalyzed: allStructNames.size,
    structsChanged,
    structsAdded,
    structsRemoved,
    fieldsAdded,
    fieldsRemoved,
    fieldsModified,
    conflictCount,
    changes,
    merged,
    unresolvedConflicts,
  };
}

/**
 * Generate merged YAML data from changes
 */
function generateMergedData(
  changes: StructChange[],
  yamlData: YamlData,
  reclassData: YamlData,
  options: SyncOptions
): YamlData {
  const mergedStructs: YamlStruct[] = [];

  for (const change of changes) {
    if (change.changeType === 'removed') {
      continue; // Skip removed structs
    }

    if (change.changeType === 'added') {
      // Use the source struct directly
      const sourceStruct = change.reclassStruct || change.yamlStruct;
      if (sourceStruct) {
        mergedStructs.push(sourceStruct);
      }
      continue;
    }

    // Modified or unchanged - merge fields
    const baseStruct = change.yamlStruct || change.reclassStruct;
    if (!baseStruct) continue;

    const mergedFields: YamlField[] = [];
    for (const fieldChange of change.fieldChanges) {
      if (fieldChange.changeType === 'removed') {
        continue; // Skip removed fields
      }

      if (fieldChange.mergedField) {
        mergedFields.push(fieldChange.mergedField);
      } else if (fieldChange.yamlField) {
        mergedFields.push(fieldChange.yamlField);
      } else if (fieldChange.reclassField) {
        mergedFields.push(fieldChange.reclassField);
      }
    }

    // Sort fields by offset
    mergedFields.sort((a, b) => parseOffset(a.offset) - parseOffset(b.offset));

    // Determine merged size
    let mergedSize = baseStruct.size;
    if (change.sizeChanged) {
      // Use larger size if bidirectional, or source size based on direction
      if (options.direction === 'bidirectional') {
        mergedSize = Math.max(change.oldSize || 0, change.newSize || 0);
      } else if (options.direction === 'reclass-to-yaml') {
        mergedSize = change.newSize;
      }
    }

    const mergedStruct: YamlStruct = {
      type: baseStruct.type,
      size: mergedSize,
      fields: mergedFields,
    };

    // Preserve other metadata from YAML
    if (baseStruct.base) mergedStruct.base = baseStruct.base;
    if (baseStruct.vfuncs) mergedStruct.vfuncs = baseStruct.vfuncs;
    if (baseStruct.funcs) mergedStruct.funcs = baseStruct.funcs;
    if (baseStruct.notes) mergedStruct.notes = baseStruct.notes;
    if (baseStruct.union) mergedStruct.union = baseStruct.union;
    if (baseStruct.category) mergedStruct.category = baseStruct.category;

    mergedStructs.push(mergedStruct);
  }

  // Merge enums (simpler - just combine)
  const yamlEnums = new Map<string, YamlEnum>();
  const reclassEnums = new Map<string, YamlEnum>();

  for (const e of yamlData.enums || []) {
    yamlEnums.set(e.type, e);
  }
  for (const e of reclassData.enums || []) {
    reclassEnums.set(e.type, e);
  }

  const mergedEnums: YamlEnum[] = [];
  const allEnumNames = new Set([...yamlEnums.keys(), ...reclassEnums.keys()]);

  for (const enumName of allEnumNames) {
    const yamlEnum = yamlEnums.get(enumName);
    const reclassEnum = reclassEnums.get(enumName);

    if (yamlEnum && reclassEnum) {
      // Merge values
      mergedEnums.push({
        type: enumName,
        underlying: yamlEnum.underlying || reclassEnum.underlying,
        values: { ...reclassEnum.values, ...yamlEnum.values },
      });
    } else {
      mergedEnums.push(yamlEnum || reclassEnum!);
    }
  }

  return {
    structs: mergedStructs,
    enums: mergedEnums,
  };
}

// ============================================================================
// Diff Generation
// ============================================================================

/**
 * Generate a human-readable diff summary
 */
export function generateDiffSummary(result: SyncResult): string {
  const lines: string[] = [];

  lines.push(`Sync Direction: ${result.direction}`);
  lines.push(`Structs: ${result.structsAnalyzed} analyzed, ${result.structsChanged} changed, ${result.structsAdded} added, ${result.structsRemoved} removed`);
  lines.push(`Fields: ${result.fieldsAdded} added, ${result.fieldsRemoved} removed, ${result.fieldsModified} modified`);
  lines.push(`Conflicts: ${result.conflictCount} (${result.unresolvedConflicts.length} unresolved)`);
  lines.push('');

  // Details for each changed struct
  for (const change of result.changes) {
    if (change.changeType === 'unchanged') continue;

    lines.push(`[${change.changeType.toUpperCase()}] ${change.structName}`);

    if (change.sizeChanged) {
      lines.push(`  Size: ${toHex(change.oldSize || 0)} -> ${toHex(change.newSize || 0)}`);
    }

    for (const fieldChange of change.fieldChanges) {
      if (fieldChange.changeType === 'unchanged') continue;

      const offsetStr = toHex(fieldChange.offset);
      const conflictMark = fieldChange.conflict ? ' [CONFLICT]' : '';

      switch (fieldChange.changeType) {
        case 'added':
          lines.push(`  + ${offsetStr}: ${fieldChange.reclassField?.name || '(unnamed)'} (${fieldChange.reclassField?.type})${conflictMark}`);
          break;
        case 'removed':
          lines.push(`  - ${offsetStr}: ${fieldChange.yamlField?.name || '(unnamed)'} (${fieldChange.yamlField?.type})${conflictMark}`);
          break;
        case 'modified':
          const oldName = fieldChange.yamlField?.name || '(unnamed)';
          const newName = fieldChange.reclassField?.name || '(unnamed)';
          const oldType = fieldChange.yamlField?.type || '?';
          const newType = fieldChange.reclassField?.type || '?';
          lines.push(`  ~ ${offsetStr}: ${oldName} (${oldType}) -> ${newName} (${newType})${conflictMark}`);
          if (fieldChange.conflictReason) {
            lines.push(`    ${fieldChange.conflictReason}`);
          }
          break;
      }
    }

    lines.push('');
  }

  return lines.join('\n');
}

// ============================================================================
// Conflict Resolution Helpers
// ============================================================================

/**
 * Resolve a specific conflict with a chosen resolution
 */
export function resolveConflict(
  change: FieldChange,
  resolution: 'yaml' | 'reclass' | 'merge'
): FieldChange {
  const resolved = { ...change };

  switch (resolution) {
    case 'yaml':
      resolved.mergedField = resolved.yamlField;
      break;
    case 'reclass':
      resolved.mergedField = resolved.reclassField;
      break;
    case 'merge':
      if (resolved.yamlField && resolved.reclassField) {
        resolved.mergedField = {
          type: resolved.yamlField.type,
          offset: resolved.yamlField.offset,
          name: resolved.reclassField.name || resolved.yamlField.name,
          size: Math.max(resolved.yamlField.size || 0, resolved.reclassField.size || 0) || undefined,
          notes: resolved.yamlField.notes || resolved.reclassField.notes,
        };
      }
      break;
  }

  resolved.conflict = false;
  resolved.conflictReason = `Manually resolved: ${resolution}`;
  return resolved;
}

export default {
  syncData,
  compareStructs,
  compareFields,
  generateDiffSummary,
  resolveConflict,
};
