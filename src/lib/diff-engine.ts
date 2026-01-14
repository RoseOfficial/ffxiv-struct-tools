/**
 * Diff engine for comparing FFXIVClientStructs YAML definitions
 * Detects changes between versions and identifies patterns like bulk offset shifts
 */

import type { YamlStruct, YamlField, YamlFunc, YamlVFunc, YamlEnum } from './types.js';
import { parseOffset, toHex } from './types.js';

// ============================================================================
// Diff Result Types
// ============================================================================

export type ChangeType = 'added' | 'removed' | 'modified';

export interface FieldChange {
  type: ChangeType;
  fieldName: string;
  fieldType: string;
  oldOffset?: number;
  newOffset?: number;
  oldType?: string;
  newType?: string;
  oldSize?: number;
  newSize?: number;
}

export interface FuncChange {
  type: ChangeType;
  funcName: string;
  oldAddress?: number;
  newAddress?: number;
  oldSignature?: string;
  newSignature?: string;
}

export interface VFuncChange {
  type: ChangeType;
  funcName: string;
  oldId?: number;
  newId?: number;
  oldSignature?: string;
  newSignature?: string;
}

export interface StructDiff {
  type: ChangeType;
  structName: string;
  oldSize?: number;
  newSize?: number;
  fieldChanges: FieldChange[];
  funcChanges: FuncChange[];
  vfuncChanges: VFuncChange[];
}

export interface EnumValueChange {
  type: ChangeType;
  name: string;
  oldValue?: number | string;
  newValue?: number | string;
}

export interface EnumDiff {
  type: ChangeType;
  enumName: string;
  oldUnderlying?: string;
  newUnderlying?: string;
  valueChanges: EnumValueChange[];
}

// ============================================================================
// Pattern Detection Types
// ============================================================================

export interface OffsetShiftPattern {
  /** The minimum offset at which the shift begins */
  startOffset: number;
  /** The offset delta (positive = shifted forward, negative = shifted backward) */
  delta: number;
  /** Number of fields that match this pattern */
  matchCount: number;
  /** Confidence score (0-1) based on consistency */
  confidence: number;
  /** Affected field names */
  affectedFields: string[];
}

export interface VTableShiftPattern {
  /** VTable slot shift delta */
  delta: number;
  /** Number of vfuncs that match this pattern */
  matchCount: number;
  /** Confidence score (0-1) */
  confidence: number;
  /** Affected function names */
  affectedFuncs: string[];
}

export interface PatternAnalysis {
  /** Detected offset shift patterns */
  offsetShifts: OffsetShiftPattern[];
  /** Detected vtable slot shifts */
  vtableShifts: VTableShiftPattern[];
  /** Overall size change delta if consistent */
  sizeChangeDelta?: number;
  /** Summary of the analysis */
  summary: string;
}

export interface DiffResult {
  /** Struct differences */
  structs: StructDiff[];
  /** Enum differences */
  enums: EnumDiff[];
  /** Detected patterns across all changes */
  patterns: PatternAnalysis;
  /** Summary statistics */
  stats: DiffStats;
}

export interface DiffStats {
  structsAdded: number;
  structsRemoved: number;
  structsModified: number;
  enumsAdded: number;
  enumsRemoved: number;
  enumsModified: number;
  totalFieldChanges: number;
  totalFuncChanges: number;
}

// ============================================================================
// Diff Engine Implementation
// ============================================================================

/**
 * Compare two sets of struct definitions and produce a diff
 */
export function diffStructs(
  oldStructs: YamlStruct[],
  newStructs: YamlStruct[]
): StructDiff[] {
  const diffs: StructDiff[] = [];

  // Create lookup maps by type name
  const oldMap = new Map(oldStructs.map(s => [s.type, s]));
  const newMap = new Map(newStructs.map(s => [s.type, s]));

  // Find removed structs
  for (const [name, oldStruct] of oldMap) {
    if (!newMap.has(name)) {
      diffs.push({
        type: 'removed',
        structName: name,
        oldSize: oldStruct.size,
        fieldChanges: [],
        funcChanges: [],
        vfuncChanges: [],
      });
    }
  }

  // Find added and modified structs
  for (const [name, newStruct] of newMap) {
    const oldStruct = oldMap.get(name);

    if (!oldStruct) {
      diffs.push({
        type: 'added',
        structName: name,
        newSize: newStruct.size,
        fieldChanges: [],
        funcChanges: [],
        vfuncChanges: [],
      });
    } else {
      // Compare the two versions
      const structDiff = compareStructs(oldStruct, newStruct);
      if (structDiff) {
        diffs.push(structDiff);
      }
    }
  }

  return diffs;
}

/**
 * Compare two struct definitions and return diff if changed
 */
function compareStructs(oldStruct: YamlStruct, newStruct: YamlStruct): StructDiff | null {
  const fieldChanges = diffFields(oldStruct.fields || [], newStruct.fields || []);
  const funcChanges = diffFuncs(oldStruct.funcs || [], newStruct.funcs || []);
  const vfuncChanges = diffVFuncs(oldStruct.vfuncs || [], newStruct.vfuncs || []);

  const sizeChanged = oldStruct.size !== newStruct.size;

  if (!sizeChanged &&
      fieldChanges.length === 0 &&
      funcChanges.length === 0 &&
      vfuncChanges.length === 0) {
    return null;
  }

  return {
    type: 'modified',
    structName: oldStruct.type,
    oldSize: oldStruct.size,
    newSize: newStruct.size,
    fieldChanges,
    funcChanges,
    vfuncChanges,
  };
}

/**
 * Compare field lists and produce changes
 */
function diffFields(oldFields: YamlField[], newFields: YamlField[]): FieldChange[] {
  const changes: FieldChange[] = [];

  // Create maps by field name (or by offset if unnamed)
  const oldByName = new Map<string, YamlField>();
  const newByName = new Map<string, YamlField>();

  for (const field of oldFields) {
    const key = field.name || `__offset_${parseOffset(field.offset)}`;
    oldByName.set(key, field);
  }

  for (const field of newFields) {
    const key = field.name || `__offset_${parseOffset(field.offset)}`;
    newByName.set(key, field);
  }

  // Find removed fields
  for (const [name, oldField] of oldByName) {
    if (!newByName.has(name)) {
      changes.push({
        type: 'removed',
        fieldName: name,
        fieldType: oldField.type,
        oldOffset: parseOffset(oldField.offset),
        oldType: oldField.type,
        oldSize: oldField.size,
      });
    }
  }

  // Find added and modified fields
  for (const [name, newField] of newByName) {
    const oldField = oldByName.get(name);

    if (!oldField) {
      changes.push({
        type: 'added',
        fieldName: name,
        fieldType: newField.type,
        newOffset: parseOffset(newField.offset),
        newType: newField.type,
        newSize: newField.size,
      });
    } else {
      // Check for modifications
      const oldOffset = parseOffset(oldField.offset);
      const newOffset = parseOffset(newField.offset);
      const offsetChanged = oldOffset !== newOffset;
      const typeChanged = oldField.type !== newField.type;
      const sizeChanged = oldField.size !== newField.size;

      if (offsetChanged || typeChanged || sizeChanged) {
        changes.push({
          type: 'modified',
          fieldName: name,
          fieldType: newField.type,
          oldOffset: oldOffset,
          newOffset: newOffset,
          oldType: oldField.type,
          newType: newField.type,
          oldSize: oldField.size,
          newSize: newField.size,
        });
      }
    }
  }

  return changes;
}

/**
 * Compare function lists and produce changes
 */
function diffFuncs(oldFuncs: YamlFunc[], newFuncs: YamlFunc[]): FuncChange[] {
  const changes: FuncChange[] = [];

  const oldByName = new Map(oldFuncs.filter(f => f.name).map(f => [f.name!, f]));
  const newByName = new Map(newFuncs.filter(f => f.name).map(f => [f.name!, f]));

  // Find removed
  for (const [name, oldFunc] of oldByName) {
    if (!newByName.has(name)) {
      changes.push({
        type: 'removed',
        funcName: name,
        oldAddress: parseOffset(oldFunc.ea),
        oldSignature: oldFunc.signature,
      });
    }
  }

  // Find added and modified
  for (const [name, newFunc] of newByName) {
    const oldFunc = oldByName.get(name);

    if (!oldFunc) {
      changes.push({
        type: 'added',
        funcName: name,
        newAddress: parseOffset(newFunc.ea),
        newSignature: newFunc.signature,
      });
    } else {
      const oldAddr = parseOffset(oldFunc.ea);
      const newAddr = parseOffset(newFunc.ea);
      const addrChanged = oldAddr !== newAddr;
      const sigChanged = oldFunc.signature !== newFunc.signature;

      if (addrChanged || sigChanged) {
        changes.push({
          type: 'modified',
          funcName: name,
          oldAddress: oldAddr,
          newAddress: newAddr,
          oldSignature: oldFunc.signature,
          newSignature: newFunc.signature,
        });
      }
    }
  }

  return changes;
}

/**
 * Compare virtual function lists and produce changes
 */
function diffVFuncs(oldVFuncs: YamlVFunc[], newVFuncs: YamlVFunc[]): VFuncChange[] {
  const changes: VFuncChange[] = [];

  const oldByName = new Map(oldVFuncs.filter(f => f.name).map(f => [f.name!, f]));
  const newByName = new Map(newVFuncs.filter(f => f.name).map(f => [f.name!, f]));

  // Find removed
  for (const [name, oldFunc] of oldByName) {
    if (!newByName.has(name)) {
      changes.push({
        type: 'removed',
        funcName: name,
        oldId: oldFunc.id,
        oldSignature: oldFunc.signature,
      });
    }
  }

  // Find added and modified
  for (const [name, newFunc] of newByName) {
    const oldFunc = oldByName.get(name);

    if (!oldFunc) {
      changes.push({
        type: 'added',
        funcName: name,
        newId: newFunc.id,
        newSignature: newFunc.signature,
      });
    } else {
      const idChanged = oldFunc.id !== newFunc.id;
      const sigChanged = oldFunc.signature !== newFunc.signature;

      if (idChanged || sigChanged) {
        changes.push({
          type: 'modified',
          funcName: name,
          oldId: oldFunc.id,
          newId: newFunc.id,
          oldSignature: oldFunc.signature,
          newSignature: newFunc.signature,
        });
      }
    }
  }

  return changes;
}

/**
 * Compare enum definitions
 */
export function diffEnums(
  oldEnums: YamlEnum[],
  newEnums: YamlEnum[]
): EnumDiff[] {
  const diffs: EnumDiff[] = [];

  const oldMap = new Map(oldEnums.map(e => [e.type, e]));
  const newMap = new Map(newEnums.map(e => [e.type, e]));

  // Find removed
  for (const [name, oldEnum] of oldMap) {
    if (!newMap.has(name)) {
      diffs.push({
        type: 'removed',
        enumName: name,
        oldUnderlying: oldEnum.underlying,
        valueChanges: [],
      });
    }
  }

  // Find added and modified
  for (const [name, newEnum] of newMap) {
    const oldEnum = oldMap.get(name);

    if (!oldEnum) {
      diffs.push({
        type: 'added',
        enumName: name,
        newUnderlying: newEnum.underlying,
        valueChanges: [],
      });
    } else {
      const valueChanges = diffEnumValues(oldEnum.values || {}, newEnum.values || {});
      const underlyingChanged = oldEnum.underlying !== newEnum.underlying;

      if (underlyingChanged || valueChanges.length > 0) {
        diffs.push({
          type: 'modified',
          enumName: name,
          oldUnderlying: oldEnum.underlying,
          newUnderlying: newEnum.underlying,
          valueChanges,
        });
      }
    }
  }

  return diffs;
}

/**
 * Compare enum value dictionaries
 */
function diffEnumValues(
  oldValues: Record<string, number | string>,
  newValues: Record<string, number | string>
): EnumValueChange[] {
  const changes: EnumValueChange[] = [];

  // Find removed
  for (const [name, value] of Object.entries(oldValues)) {
    if (!(name in newValues)) {
      changes.push({ type: 'removed', name, oldValue: value });
    }
  }

  // Find added and modified
  for (const [name, value] of Object.entries(newValues)) {
    if (!(name in oldValues)) {
      changes.push({ type: 'added', name, newValue: value });
    } else if (oldValues[name] !== value) {
      changes.push({
        type: 'modified',
        name,
        oldValue: oldValues[name],
        newValue: value,
      });
    }
  }

  return changes;
}

// ============================================================================
// Pattern Detection
// ============================================================================

/**
 * Analyze struct diffs to detect patterns like bulk offset shifts
 */
export function analyzePatterns(structDiffs: StructDiff[]): PatternAnalysis {
  const allOffsetShifts: { offset: number; delta: number; fieldName: string; structName: string }[] = [];
  const allVTableShifts: { delta: number; funcName: string; structName: string }[] = [];
  const sizeDeltas: number[] = [];

  // Collect all offset changes
  for (const diff of structDiffs) {
    if (diff.type !== 'modified') continue;

    // Collect size deltas
    if (diff.oldSize !== undefined && diff.newSize !== undefined) {
      sizeDeltas.push(diff.newSize - diff.oldSize);
    }

    // Collect field offset changes
    for (const fieldChange of diff.fieldChanges) {
      if (fieldChange.type === 'modified' &&
          fieldChange.oldOffset !== undefined &&
          fieldChange.newOffset !== undefined) {
        const delta = fieldChange.newOffset - fieldChange.oldOffset;
        if (delta !== 0) {
          allOffsetShifts.push({
            offset: fieldChange.oldOffset,
            delta,
            fieldName: fieldChange.fieldName,
            structName: diff.structName,
          });
        }
      }
    }

    // Collect vtable slot changes
    for (const vfuncChange of diff.vfuncChanges) {
      if (vfuncChange.type === 'modified' &&
          vfuncChange.oldId !== undefined &&
          vfuncChange.newId !== undefined) {
        const delta = vfuncChange.newId - vfuncChange.oldId;
        if (delta !== 0) {
          allVTableShifts.push({
            delta,
            funcName: vfuncChange.funcName,
            structName: diff.structName,
          });
        }
      }
    }
  }

  const offsetShifts = detectOffsetShiftPatterns(allOffsetShifts);
  const vtableShifts = detectVTableShiftPatterns(allVTableShifts);
  const sizeChangeDelta = detectConsistentSizeDelta(sizeDeltas);

  const summary = generatePatternSummary(offsetShifts, vtableShifts, sizeChangeDelta);

  return {
    offsetShifts,
    vtableShifts,
    sizeChangeDelta,
    summary,
  };
}

/**
 * Detect bulk offset shift patterns
 * Groups offset changes by their delta and looks for patterns
 */
function detectOffsetShiftPatterns(
  shifts: { offset: number; delta: number; fieldName: string; structName: string }[]
): OffsetShiftPattern[] {
  if (shifts.length === 0) return [];

  // Group by delta value
  const byDelta = new Map<number, typeof shifts>();
  for (const shift of shifts) {
    const existing = byDelta.get(shift.delta) || [];
    existing.push(shift);
    byDelta.set(shift.delta, existing);
  }

  const patterns: OffsetShiftPattern[] = [];

  for (const [delta, deltaShifts] of byDelta) {
    if (deltaShifts.length < 2) continue; // Need at least 2 to be a pattern

    // Find the minimum offset where this shift starts
    const minOffset = Math.min(...deltaShifts.map(s => s.offset));

    // Calculate confidence based on how many fields have this exact delta
    const confidence = Math.min(1, deltaShifts.length / 10); // Max confidence at 10+ matches

    patterns.push({
      startOffset: minOffset,
      delta,
      matchCount: deltaShifts.length,
      confidence,
      affectedFields: deltaShifts.map(s => `${s.structName}.${s.fieldName}`),
    });
  }

  // Sort by match count descending (most significant patterns first)
  patterns.sort((a, b) => b.matchCount - a.matchCount);

  return patterns;
}

/**
 * Detect vtable slot shift patterns
 */
function detectVTableShiftPatterns(
  shifts: { delta: number; funcName: string; structName: string }[]
): VTableShiftPattern[] {
  if (shifts.length === 0) return [];

  // Group by delta
  const byDelta = new Map<number, typeof shifts>();
  for (const shift of shifts) {
    const existing = byDelta.get(shift.delta) || [];
    existing.push(shift);
    byDelta.set(shift.delta, existing);
  }

  const patterns: VTableShiftPattern[] = [];

  for (const [delta, deltaShifts] of byDelta) {
    if (deltaShifts.length < 2) continue;

    const confidence = Math.min(1, deltaShifts.length / 5);

    patterns.push({
      delta,
      matchCount: deltaShifts.length,
      confidence,
      affectedFuncs: deltaShifts.map(s => `${s.structName}.${s.funcName}`),
    });
  }

  patterns.sort((a, b) => b.matchCount - a.matchCount);

  return patterns;
}

/**
 * Detect if there's a consistent size change across modified structs
 */
function detectConsistentSizeDelta(sizeDeltas: number[]): number | undefined {
  if (sizeDeltas.length === 0) return undefined;

  // Count occurrences of each delta
  const counts = new Map<number, number>();
  for (const delta of sizeDeltas) {
    counts.set(delta, (counts.get(delta) || 0) + 1);
  }

  // Find the most common non-zero delta
  let maxCount = 0;
  let mostCommonDelta: number | undefined;

  for (const [delta, count] of counts) {
    if (delta !== 0 && count > maxCount) {
      maxCount = count;
      mostCommonDelta = delta;
    }
  }

  // Only return if it's the majority
  if (mostCommonDelta !== undefined && maxCount > sizeDeltas.length / 2) {
    return mostCommonDelta;
  }

  return undefined;
}

/**
 * Generate a human-readable summary of detected patterns
 */
function generatePatternSummary(
  offsetShifts: OffsetShiftPattern[],
  vtableShifts: VTableShiftPattern[],
  sizeChangeDelta: number | undefined
): string {
  const parts: string[] = [];

  if (offsetShifts.length > 0) {
    const topPattern = offsetShifts[0];
    const sign = topPattern.delta > 0 ? '+' : '';
    parts.push(
      `Detected offset shift: ${sign}${toHex(topPattern.delta)} starting at ${toHex(topPattern.startOffset)} ` +
      `(${topPattern.matchCount} fields, ${(topPattern.confidence * 100).toFixed(0)}% confidence)`
    );
  }

  if (vtableShifts.length > 0) {
    const topPattern = vtableShifts[0];
    const sign = topPattern.delta > 0 ? '+' : '';
    parts.push(
      `Detected vtable shift: ${sign}${topPattern.delta} slots ` +
      `(${topPattern.matchCount} functions, ${(topPattern.confidence * 100).toFixed(0)}% confidence)`
    );
  }

  if (sizeChangeDelta !== undefined) {
    const sign = sizeChangeDelta > 0 ? '+' : '';
    parts.push(`Consistent struct size change: ${sign}${toHex(sizeChangeDelta)}`);
  }

  if (parts.length === 0) {
    return 'No consistent patterns detected';
  }

  return parts.join('\n');
}

// ============================================================================
// Full Diff Operation
// ============================================================================

/**
 * Perform a complete diff between two sets of parsed data
 */
export function diff(
  oldStructs: YamlStruct[],
  newStructs: YamlStruct[],
  oldEnums: YamlEnum[],
  newEnums: YamlEnum[]
): DiffResult {
  const structDiffs = diffStructs(oldStructs, newStructs);
  const enumDiffs = diffEnums(oldEnums, newEnums);
  const patterns = analyzePatterns(structDiffs);

  // Calculate stats
  const stats: DiffStats = {
    structsAdded: structDiffs.filter(d => d.type === 'added').length,
    structsRemoved: structDiffs.filter(d => d.type === 'removed').length,
    structsModified: structDiffs.filter(d => d.type === 'modified').length,
    enumsAdded: enumDiffs.filter(d => d.type === 'added').length,
    enumsRemoved: enumDiffs.filter(d => d.type === 'removed').length,
    enumsModified: enumDiffs.filter(d => d.type === 'modified').length,
    totalFieldChanges: structDiffs.reduce((sum, d) => sum + d.fieldChanges.length, 0),
    totalFuncChanges: structDiffs.reduce(
      (sum, d) => sum + d.funcChanges.length + d.vfuncChanges.length, 0
    ),
  };

  return {
    structs: structDiffs,
    enums: enumDiffs,
    patterns,
    stats,
  };
}
