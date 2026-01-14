/**
 * Patch engine for applying offset changes to FFXIVClientStructs YAML definitions
 * Supports both manual patches and auto-generated patches from diff results
 */

import type { YamlStruct, YamlField, YamlVFunc, YamlEnum } from './types.js';
import { parseOffset, toHex } from './types.js';
import type { DiffResult, OffsetShiftPattern, VTableShiftPattern } from './diff-engine.js';

// ============================================================================
// Patch Types
// ============================================================================

export type PatchOperationType = 'shift_offset' | 'shift_vfunc' | 'set_size' | 'rename_field' | 'rename_struct';

export interface OffsetShiftPatch {
  type: 'shift_offset';
  /** Struct name pattern (supports wildcards) */
  structPattern: string;
  /** Minimum offset to start shifting from (inclusive) */
  startOffset: number;
  /** Offset delta to apply (positive or negative) */
  delta: number;
  /** Optional: specific field names to affect */
  fieldPattern?: string;
}

export interface VFuncShiftPatch {
  type: 'shift_vfunc';
  /** Struct name pattern */
  structPattern: string;
  /** Starting VFunc ID to shift from */
  startId: number;
  /** VFunc slot delta to apply */
  delta: number;
}

export interface SizePatch {
  type: 'set_size';
  /** Struct name pattern */
  structPattern: string;
  /** New size (absolute) or delta (prefixed with + or -) */
  size: number;
  /** Whether size is a delta */
  isDelta: boolean;
}

export interface RenameFieldPatch {
  type: 'rename_field';
  /** Struct name pattern */
  structPattern: string;
  /** Old field name */
  oldName: string;
  /** New field name */
  newName: string;
}

export interface RenameStructPatch {
  type: 'rename_struct';
  /** Old struct name */
  oldName: string;
  /** New struct name */
  newName: string;
}

export type Patch =
  | OffsetShiftPatch
  | VFuncShiftPatch
  | SizePatch
  | RenameFieldPatch
  | RenameStructPatch;

export interface PatchSet {
  /** Descriptive name for this patch set */
  name: string;
  /** Optional description */
  description?: string;
  /** Version this patch was created for */
  fromVersion?: string;
  /** Version this patch targets */
  toVersion?: string;
  /** Individual patches to apply */
  patches: Patch[];
}

export interface PatchResult {
  /** Was the struct/enum modified? */
  modified: boolean;
  /** Description of changes made */
  changes: string[];
}

export interface ApplyResult {
  /** Total structs processed */
  structsProcessed: number;
  /** Structs that were modified */
  structsModified: number;
  /** Total enums processed */
  enumsProcessed: number;
  /** Enums that were modified */
  enumsModified: number;
  /** Detailed changes per struct/enum */
  details: Map<string, string[]>;
}

// ============================================================================
// Patch Generation from Diff
// ============================================================================

/**
 * Generate a patch set from diff results
 */
export function generatePatchFromDiff(
  diffResult: DiffResult,
  options: {
    fromVersion?: string;
    toVersion?: string;
  } = {}
): PatchSet {
  const patches: Patch[] = [];
  const { patterns } = diffResult;

  // Generate offset shift patches from detected patterns
  for (const pattern of patterns.offsetShifts) {
    if (pattern.confidence >= 0.3 && pattern.matchCount >= 3) {
      // Create patches per struct
      const structNames = new Set(
        pattern.affectedFields.map(f => f.split('.')[0])
      );

      for (const structName of structNames) {
        patches.push({
          type: 'shift_offset',
          structPattern: structName,
          startOffset: pattern.startOffset,
          delta: pattern.delta,
        });
      }
    }
  }

  // Generate vtable shift patches from detected patterns
  for (const pattern of patterns.vtableShifts) {
    if (pattern.confidence >= 0.3 && pattern.matchCount >= 2) {
      const structNames = new Set(
        pattern.affectedFuncs.map(f => f.split('.')[0])
      );

      for (const structName of structNames) {
        patches.push({
          type: 'shift_vfunc',
          structPattern: structName,
          startId: 0, // Start from beginning
          delta: pattern.delta,
        });
      }
    }
  }

  // Generate size patches for structs with consistent size changes
  if (patterns.sizeChangeDelta !== undefined) {
    for (const structDiff of diffResult.structs) {
      if (structDiff.type === 'modified' &&
          structDiff.oldSize !== undefined &&
          structDiff.newSize !== undefined) {
        const actualDelta = structDiff.newSize - structDiff.oldSize;
        if (actualDelta === patterns.sizeChangeDelta) {
          patches.push({
            type: 'set_size',
            structPattern: structDiff.structName,
            size: patterns.sizeChangeDelta,
            isDelta: true,
          });
        }
      }
    }
  }

  return {
    name: `Auto-generated patch`,
    description: `Patch generated from diff analysis. ${patterns.summary}`,
    fromVersion: options.fromVersion,
    toVersion: options.toVersion,
    patches,
  };
}

/**
 * Generate a simple offset shift patch
 */
export function createOffsetShiftPatch(
  structPattern: string,
  startOffset: number,
  delta: number
): OffsetShiftPatch {
  return {
    type: 'shift_offset',
    structPattern,
    startOffset,
    delta,
  };
}

/**
 * Generate a vtable shift patch
 */
export function createVFuncShiftPatch(
  structPattern: string,
  startId: number,
  delta: number
): VFuncShiftPatch {
  return {
    type: 'shift_vfunc',
    structPattern,
    startId,
    delta,
  };
}

// ============================================================================
// Patch Application
// ============================================================================

/**
 * Apply a patch set to structs and enums
 * Returns new copies of the modified data (does not mutate input)
 */
export function applyPatchSet(
  structs: YamlStruct[],
  enums: YamlEnum[],
  patchSet: PatchSet
): { structs: YamlStruct[]; enums: YamlEnum[]; result: ApplyResult } {
  const result: ApplyResult = {
    structsProcessed: structs.length,
    structsModified: 0,
    enumsProcessed: enums.length,
    enumsModified: 0,
    details: new Map(),
  };

  // Deep clone inputs
  const newStructs = JSON.parse(JSON.stringify(structs)) as YamlStruct[];
  const newEnums = JSON.parse(JSON.stringify(enums)) as YamlEnum[];

  // Apply each patch
  for (const patch of patchSet.patches) {
    switch (patch.type) {
      case 'shift_offset':
        applyOffsetShiftPatch(newStructs, patch, result);
        break;
      case 'shift_vfunc':
        applyVFuncShiftPatch(newStructs, patch, result);
        break;
      case 'set_size':
        applySizePatch(newStructs, patch, result);
        break;
      case 'rename_field':
        applyRenameFieldPatch(newStructs, patch, result);
        break;
      case 'rename_struct':
        applyRenameStructPatch(newStructs, patch, result);
        break;
    }
  }

  return { structs: newStructs, enums: newEnums, result };
}

/**
 * Apply a single offset shift patch
 */
function applyOffsetShiftPatch(
  structs: YamlStruct[],
  patch: OffsetShiftPatch,
  result: ApplyResult
): void {
  for (const struct of structs) {
    if (!matchesPattern(struct.type, patch.structPattern)) continue;
    if (!struct.fields) continue;

    const changes: string[] = [];
    let modified = false;

    for (const field of struct.fields) {
      const offset = parseOffset(field.offset);
      if (offset >= patch.startOffset) {
        // Check field pattern if specified
        if (patch.fieldPattern && field.name && !matchesPattern(field.name, patch.fieldPattern)) {
          continue;
        }

        const newOffset = offset + patch.delta;
        const oldHex = toHex(offset);
        const newHex = toHex(newOffset);
        const sign = patch.delta > 0 ? '+' : '';

        changes.push(`  ${field.name || field.type}: ${oldHex} → ${newHex} (${sign}${toHex(patch.delta)})`);

        // Update the field - preserve format if original was hex string
        if (typeof field.offset === 'string' && field.offset.toLowerCase().startsWith('0x')) {
          field.offset = toHex(newOffset);
        } else {
          field.offset = newOffset;
        }
        modified = true;
      }
    }

    if (modified) {
      result.structsModified++;
      const existing = result.details.get(struct.type) || [];
      existing.push(`Offset shift (${toHex(patch.delta)} from ${toHex(patch.startOffset)}):`, ...changes);
      result.details.set(struct.type, existing);
    }
  }
}

/**
 * Apply a vtable shift patch
 */
function applyVFuncShiftPatch(
  structs: YamlStruct[],
  patch: VFuncShiftPatch,
  result: ApplyResult
): void {
  for (const struct of structs) {
    if (!matchesPattern(struct.type, patch.structPattern)) continue;
    if (!struct.vfuncs) continue;

    const changes: string[] = [];
    let modified = false;

    for (const vfunc of struct.vfuncs) {
      if (vfunc.id !== undefined && vfunc.id >= patch.startId) {
        const oldId = vfunc.id;
        const newId = oldId + patch.delta;
        const sign = patch.delta > 0 ? '+' : '';

        changes.push(`  ${vfunc.name || 'unnamed'}: slot ${oldId} → ${newId} (${sign}${patch.delta})`);

        vfunc.id = newId;
        modified = true;
      }
    }

    if (modified) {
      result.structsModified++;
      const existing = result.details.get(struct.type) || [];
      existing.push(`VFunc slot shift (${patch.delta > 0 ? '+' : ''}${patch.delta} from slot ${patch.startId}):`, ...changes);
      result.details.set(struct.type, existing);
    }
  }
}

/**
 * Apply a size patch
 */
function applySizePatch(
  structs: YamlStruct[],
  patch: SizePatch,
  result: ApplyResult
): void {
  for (const struct of structs) {
    if (!matchesPattern(struct.type, patch.structPattern)) continue;

    const oldSize = struct.size;
    let newSize: number;

    if (patch.isDelta) {
      newSize = (oldSize || 0) + patch.size;
    } else {
      newSize = patch.size;
    }

    if (oldSize !== newSize) {
      const sign = patch.isDelta && patch.size > 0 ? '+' : '';
      const change = patch.isDelta
        ? `Size: ${toHex(oldSize || 0)} → ${toHex(newSize)} (${sign}${toHex(patch.size)})`
        : `Size: ${toHex(oldSize || 0)} → ${toHex(newSize)}`;

      struct.size = newSize;
      result.structsModified++;

      const existing = result.details.get(struct.type) || [];
      existing.push(change);
      result.details.set(struct.type, existing);
    }
  }
}

/**
 * Apply a rename field patch
 */
function applyRenameFieldPatch(
  structs: YamlStruct[],
  patch: RenameFieldPatch,
  result: ApplyResult
): void {
  for (const struct of structs) {
    if (!matchesPattern(struct.type, patch.structPattern)) continue;
    if (!struct.fields) continue;

    for (const field of struct.fields) {
      if (field.name === patch.oldName) {
        field.name = patch.newName;
        result.structsModified++;

        const existing = result.details.get(struct.type) || [];
        existing.push(`Renamed field: ${patch.oldName} → ${patch.newName}`);
        result.details.set(struct.type, existing);
      }
    }
  }
}

/**
 * Apply a rename struct patch
 */
function applyRenameStructPatch(
  structs: YamlStruct[],
  patch: RenameStructPatch,
  result: ApplyResult
): void {
  for (const struct of structs) {
    if (struct.type === patch.oldName) {
      struct.type = patch.newName;
      result.structsModified++;

      const existing = result.details.get(patch.newName) || [];
      existing.push(`Renamed struct: ${patch.oldName} → ${patch.newName}`);
      result.details.set(patch.newName, existing);
    }
  }
}

// ============================================================================
// Pattern Matching
// ============================================================================

/**
 * Check if a name matches a pattern (supports * wildcard)
 */
export function matchesPattern(name: string, pattern: string): boolean {
  if (pattern === '*') return true;
  if (!pattern.includes('*')) return name === pattern;

  // Convert wildcard pattern to regex
  const regexPattern = pattern
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&') // Escape regex special chars except *
    .replace(/\*/g, '.*'); // Convert * to .*

  return new RegExp(`^${regexPattern}$`).test(name);
}

// ============================================================================
// Patch Serialization
// ============================================================================

/**
 * Serialize a patch set to JSON
 */
export function serializePatchSet(patchSet: PatchSet): string {
  return JSON.stringify(patchSet, null, 2);
}

/**
 * Deserialize a patch set from JSON
 */
export function deserializePatchSet(json: string): PatchSet {
  const parsed = JSON.parse(json) as PatchSet;

  // Validate structure
  if (!parsed.name || !Array.isArray(parsed.patches)) {
    throw new Error('Invalid patch set format: missing name or patches array');
  }

  // Validate each patch
  for (const patch of parsed.patches) {
    if (!patch.type) {
      throw new Error('Invalid patch: missing type');
    }
  }

  return parsed;
}

/**
 * Format apply result as human-readable string
 */
export function formatApplyResult(result: ApplyResult): string {
  const lines: string[] = [];

  lines.push(`Processed: ${result.structsProcessed} structs, ${result.enumsProcessed} enums`);
  lines.push(`Modified: ${result.structsModified} structs, ${result.enumsModified} enums`);

  if (result.details.size > 0) {
    lines.push('');
    lines.push('Details:');
    for (const [name, changes] of result.details) {
      lines.push(`  ${name}:`);
      for (const change of changes) {
        lines.push(`    ${change}`);
      }
    }
  }

  return lines.join('\n');
}
