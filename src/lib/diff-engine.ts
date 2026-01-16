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
// Inheritance Hierarchy
// ============================================================================

export interface InheritanceHierarchy {
  /** Root struct name (the ultimate base class) */
  root: string;
  /** All struct names in this hierarchy (including root) */
  members: Set<string>;
  /** Map from struct name to its direct parent */
  parentMap: Map<string, string>;
}

/**
 * Build inheritance hierarchies from struct definitions
 * Groups structs by their inheritance chains (e.g., all Character-derived structs together)
 */
export function buildInheritanceHierarchies(
  structs: YamlStruct[]
): InheritanceHierarchy[] {
  // Build parent map
  const parentMap = new Map<string, string>();
  const allStructNames = new Set<string>();

  for (const struct of structs) {
    if (struct.type) {
      allStructNames.add(struct.type);
      if (struct.base) {
        parentMap.set(struct.type, struct.base);
      }
    }
  }

  // Find root for each struct (follow parent chain until we hit a struct with no parent)
  const rootMap = new Map<string, string>();

  function findRoot(name: string, visited = new Set<string>()): string {
    if (visited.has(name)) return name; // Circular inheritance, treat as root
    visited.add(name);

    const parent = parentMap.get(name);
    if (!parent || !allStructNames.has(parent)) {
      return name; // No parent or parent not in our set = this is a root
    }
    return findRoot(parent, visited);
  }

  for (const name of allStructNames) {
    rootMap.set(name, findRoot(name));
  }

  // Group structs by their root
  const hierarchyMap = new Map<string, Set<string>>();
  for (const [name, root] of rootMap) {
    if (!hierarchyMap.has(root)) {
      hierarchyMap.set(root, new Set());
    }
    hierarchyMap.get(root)!.add(name);
  }

  // Build hierarchy objects
  const hierarchies: InheritanceHierarchy[] = [];
  for (const [root, members] of hierarchyMap) {
    // Filter parentMap to only include members of this hierarchy
    const filteredParentMap = new Map<string, string>();
    for (const member of members) {
      const parent = parentMap.get(member);
      if (parent) {
        filteredParentMap.set(member, parent);
      }
    }

    hierarchies.push({
      root,
      members,
      parentMap: filteredParentMap,
    });
  }

  // Sort by size (larger hierarchies first)
  hierarchies.sort((a, b) => b.members.size - a.members.size);

  return hierarchies;
}

// ============================================================================
// Hierarchy-Aware Delta Detection
// ============================================================================

export interface HierarchyDeltaCandidate {
  /** The inheritance hierarchy this delta applies to */
  hierarchy: string;
  /** All struct names in the hierarchy */
  structNames: string[];
  /** The detected offset delta */
  delta: number;
  /** Starting offset where shift begins */
  startOffset: number;
  /** Number of fields that match this delta */
  matchCount: number;
  /** Total fields that were analyzed */
  totalFields: number;
  /** Confidence score (0-1) */
  confidence: number;
  /** Fields that match this delta pattern */
  matchingFields: { struct: string; field: string; oldOffset: number; newOffset: number }[];
  /** Fields that don't match (potential anomalies) */
  anomalies: { struct: string; field: string; oldOffset: number; newOffset: number; actualDelta: number }[];
}

/**
 * Detect delta candidates for each inheritance hierarchy
 * This is the core algorithm for auto-detecting offset shifts
 */
export function detectHierarchyDeltas(
  oldStructs: YamlStruct[],
  newStructs: YamlStruct[],
  structDiffs: StructDiff[]
): HierarchyDeltaCandidate[] {
  // Build hierarchies from old structs (they define the structure we're patching)
  const hierarchies = buildInheritanceHierarchies(oldStructs);

  // Create lookup map for new structs
  const newStructMap = new Map(newStructs.map(s => [s.type, s]));
  const oldStructMap = new Map(oldStructs.map(s => [s.type, s]));

  const candidates: HierarchyDeltaCandidate[] = [];

  for (const hierarchy of hierarchies) {
    // Collect all field offset changes within this hierarchy
    const offsetChanges: {
      struct: string;
      field: string;
      oldOffset: number;
      newOffset: number;
      delta: number;
    }[] = [];

    for (const structName of hierarchy.members) {
      const diff = structDiffs.find(d => d.structName === structName);
      if (!diff || diff.type !== 'modified') continue;

      for (const fieldChange of diff.fieldChanges) {
        if (fieldChange.type === 'modified' &&
            fieldChange.oldOffset !== undefined &&
            fieldChange.newOffset !== undefined) {
          const delta = fieldChange.newOffset - fieldChange.oldOffset;
          if (delta !== 0) {
            offsetChanges.push({
              struct: structName,
              field: fieldChange.fieldName,
              oldOffset: fieldChange.oldOffset,
              newOffset: fieldChange.newOffset,
              delta,
            });
          }
        }
      }
    }

    if (offsetChanges.length === 0) continue;

    // Find the most common delta
    const deltaCounts = new Map<number, typeof offsetChanges>();
    for (const change of offsetChanges) {
      if (!deltaCounts.has(change.delta)) {
        deltaCounts.set(change.delta, []);
      }
      deltaCounts.get(change.delta)!.push(change);
    }

    // Sort deltas by frequency
    const sortedDeltas = [...deltaCounts.entries()]
      .sort((a, b) => b[1].length - a[1].length);

    if (sortedDeltas.length === 0) continue;

    // Take the most common delta as the candidate
    const [bestDelta, matchingChanges] = sortedDeltas[0];
    const otherChanges = offsetChanges.filter(c => c.delta !== bestDelta);

    // Find the minimum start offset
    const startOffset = Math.min(...matchingChanges.map(c => c.oldOffset));

    // Calculate confidence
    const totalChanges = offsetChanges.length;
    const matchRatio = matchingChanges.length / totalChanges;
    const hierarchySize = hierarchy.members.size;
    const sizeBonus = Math.min(0.2, hierarchySize / 50); // Larger hierarchies get slight bonus

    const confidence = Math.min(1, matchRatio * 0.8 + sizeBonus + (matchingChanges.length >= 5 ? 0.1 : 0));

    candidates.push({
      hierarchy: hierarchy.root,
      structNames: [...hierarchy.members],
      delta: bestDelta,
      startOffset,
      matchCount: matchingChanges.length,
      totalFields: totalChanges,
      confidence,
      matchingFields: matchingChanges.map(c => ({
        struct: c.struct,
        field: c.field,
        oldOffset: c.oldOffset,
        newOffset: c.newOffset,
      })),
      anomalies: otherChanges.map(c => ({
        struct: c.struct,
        field: c.field,
        oldOffset: c.oldOffset,
        newOffset: c.newOffset,
        actualDelta: c.delta,
      })),
    });
  }

  // Sort by confidence descending
  candidates.sort((a, b) => b.confidence - a.confidence);

  return candidates;
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
// Cascading Pattern Detection
// ============================================================================

export interface CascadingPattern {
  /** The base struct that caused the cascade */
  sourceStruct: string;
  /** Size increase in the base struct */
  sizeDelta: number;
  /** All affected child structs */
  affectedStructs: string[];
  /** Field offset delta in children */
  offsetDelta: number;
  /** Confidence score (0-1) */
  confidence: number;
  /** Whether this looks like a base class size increase */
  isSizeIncrease: boolean;
}

export interface CrossHierarchyPattern {
  /** Description of the cross-hierarchy pattern */
  description: string;
  /** Common delta across hierarchies */
  delta: number;
  /** Hierarchies that share this pattern */
  hierarchies: string[];
  /** Total affected structs */
  affectedCount: number;
  /** Confidence score */
  confidence: number;
}

export interface PatchSuggestion {
  /** Struct name pattern (supports wildcards) */
  structPattern: string;
  /** Offset delta to apply */
  delta: number;
  /** Starting offset for the shift */
  startOffset: number;
  /** Confidence of this suggestion */
  confidence: number;
  /** Human-readable description */
  description: string;
  /** CLI command to apply this patch */
  command: string;
}

/**
 * Detect cascading offset shifts caused by base class size changes
 * When a parent struct grows, all children need their inherited offsets shifted
 */
export function detectCascadingPatterns(
  oldStructs: YamlStruct[],
  newStructs: YamlStruct[],
  structDiffs: StructDiff[]
): CascadingPattern[] {
  const patterns: CascadingPattern[] = [];

  // Build parent-child relationships
  const oldMap = new Map(oldStructs.map(s => [s.type, s]));
  const newMap = new Map(newStructs.map(s => [s.type, s]));

  // Find structs with size changes
  const sizeChanges = structDiffs
    .filter(d => d.type === 'modified' && d.oldSize !== undefined && d.newSize !== undefined)
    .filter(d => d.newSize! !== d.oldSize!)
    .map(d => ({
      name: d.structName,
      oldSize: d.oldSize!,
      newSize: d.newSize!,
      delta: d.newSize! - d.oldSize!,
    }));

  for (const sizeChange of sizeChanges) {
    // Find all structs that inherit from this one
    const children: string[] = [];
    for (const struct of oldStructs) {
      if (struct.base === sizeChange.name) {
        children.push(struct.type);
      }
    }

    if (children.length === 0) continue;

    // Check if children have matching offset shifts
    let matchingChildCount = 0;
    const childrenWithMatchingShifts: string[] = [];

    for (const childName of children) {
      const childDiff = structDiffs.find(d => d.structName === childName);
      if (!childDiff || childDiff.type !== 'modified') continue;

      // Check if field offsets shifted by the expected amount
      const shiftedFields = childDiff.fieldChanges.filter(fc => {
        if (fc.type !== 'modified' || fc.oldOffset === undefined || fc.newOffset === undefined) return false;
        const delta = fc.newOffset - fc.oldOffset;
        // Field must be after the base struct's old size (inherited region)
        return delta === sizeChange.delta && fc.oldOffset >= sizeChange.oldSize;
      });

      if (shiftedFields.length > 0) {
        matchingChildCount++;
        childrenWithMatchingShifts.push(childName);
      }
    }

    if (matchingChildCount > 0) {
      const confidence = matchingChildCount / children.length;

      patterns.push({
        sourceStruct: sizeChange.name,
        sizeDelta: sizeChange.delta,
        affectedStructs: childrenWithMatchingShifts,
        offsetDelta: sizeChange.delta,
        confidence,
        isSizeIncrease: sizeChange.delta > 0,
      });
    }
  }

  // Sort by confidence
  patterns.sort((a, b) => b.confidence - a.confidence);

  return patterns;
}

/**
 * Detect patterns that span multiple inheritance hierarchies
 * This can indicate engine-wide changes (e.g., new field added to common base)
 */
export function detectCrossHierarchyPatterns(
  hierarchyDeltas: HierarchyDeltaCandidate[]
): CrossHierarchyPattern[] {
  const patterns: CrossHierarchyPattern[] = [];

  // Group hierarchy deltas by their delta value
  const byDelta = new Map<number, HierarchyDeltaCandidate[]>();
  for (const hd of hierarchyDeltas) {
    if (!byDelta.has(hd.delta)) {
      byDelta.set(hd.delta, []);
    }
    byDelta.get(hd.delta)!.push(hd);
  }

  // Look for deltas that appear in multiple hierarchies
  for (const [delta, candidates] of byDelta) {
    if (candidates.length < 2) continue;

    const totalAffected = candidates.reduce((sum, c) => sum + c.structNames.length, 0);
    const avgConfidence = candidates.reduce((sum, c) => sum + c.confidence, 0) / candidates.length;

    patterns.push({
      description: `Common ${delta > 0 ? '+' : ''}${toHex(delta)} shift across ${candidates.length} hierarchies`,
      delta,
      hierarchies: candidates.map(c => c.hierarchy),
      affectedCount: totalAffected,
      confidence: avgConfidence * (candidates.length / hierarchyDeltas.length + 0.5),
    });
  }

  patterns.sort((a, b) => b.confidence - a.confidence);

  return patterns;
}

/**
 * Generate patch command suggestions from detected patterns
 */
export function generatePatchSuggestions(
  hierarchyDeltas: HierarchyDeltaCandidate[],
  cascadingPatterns: CascadingPattern[],
  crossHierarchyPatterns: CrossHierarchyPattern[]
): PatchSuggestion[] {
  const suggestions: PatchSuggestion[] = [];

  // Generate suggestions from hierarchy deltas
  for (const hd of hierarchyDeltas) {
    if (hd.confidence < 0.5) continue;

    const structPattern = hd.structNames.length === 1
      ? hd.structNames[0]
      : `${hd.hierarchy}*`;

    const sign = hd.delta > 0 ? '+' : '';
    suggestions.push({
      structPattern,
      delta: hd.delta,
      startOffset: hd.startOffset,
      confidence: hd.confidence,
      description: `Shift offsets ${sign}${toHex(hd.delta)} for ${hd.hierarchy} hierarchy (${hd.matchCount} fields match)`,
      command: `fst patch --struct "${structPattern}" --delta ${sign}${toHex(hd.delta)} --start-offset ${toHex(hd.startOffset)}`,
    });
  }

  // Generate suggestions from cascading patterns
  for (const cp of cascadingPatterns) {
    if (cp.confidence < 0.6) continue;

    for (const childStruct of cp.affectedStructs) {
      const sign = cp.offsetDelta > 0 ? '+' : '';
      suggestions.push({
        structPattern: childStruct,
        delta: cp.offsetDelta,
        startOffset: 0, // Cascading affects all inherited fields
        confidence: cp.confidence * 0.9, // Slightly lower than direct pattern
        description: `Cascade from ${cp.sourceStruct} size change: shift ${childStruct} offsets ${sign}${toHex(cp.offsetDelta)}`,
        command: `fst patch --struct "${childStruct}" --delta ${sign}${toHex(cp.offsetDelta)}`,
      });
    }
  }

  // Generate suggestions from cross-hierarchy patterns
  for (const chp of crossHierarchyPatterns) {
    if (chp.confidence < 0.7) continue;

    const sign = chp.delta > 0 ? '+' : '';
    const hierarchyPatterns = chp.hierarchies.map(h => `${h}*`);

    suggestions.push({
      structPattern: hierarchyPatterns.join(', '),
      delta: chp.delta,
      startOffset: 0,
      confidence: chp.confidence,
      description: `Cross-hierarchy pattern: ${chp.description}`,
      command: `# Apply to each hierarchy:\n${hierarchyPatterns.map(p =>
        `fst patch --struct "${p}" --delta ${sign}${toHex(chp.delta)}`
      ).join('\n')}`,
    });
  }

  // Sort by confidence
  suggestions.sort((a, b) => b.confidence - a.confidence);

  // Deduplicate overlapping suggestions
  const seen = new Set<string>();
  return suggestions.filter(s => {
    const key = `${s.structPattern}:${s.delta}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
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

/**
 * Extended diff with enhanced pattern detection and patch suggestions
 */
export function diffWithSuggestions(
  oldStructs: YamlStruct[],
  newStructs: YamlStruct[],
  oldEnums: YamlEnum[],
  newEnums: YamlEnum[]
): {
  result: DiffResult;
  hierarchyDeltas: HierarchyDeltaCandidate[];
  cascadingPatterns: CascadingPattern[];
  crossHierarchyPatterns: CrossHierarchyPattern[];
  patchSuggestions: PatchSuggestion[];
} {
  const result = diff(oldStructs, newStructs, oldEnums, newEnums);

  // Run enhanced pattern detection
  const hierarchyDeltas = detectHierarchyDeltas(oldStructs, newStructs, result.structs);
  const cascadingPatterns = detectCascadingPatterns(oldStructs, newStructs, result.structs);
  const crossHierarchyPatterns = detectCrossHierarchyPatterns(hierarchyDeltas);
  const patchSuggestions = generatePatchSuggestions(
    hierarchyDeltas,
    cascadingPatterns,
    crossHierarchyPatterns
  );

  return {
    result,
    hierarchyDeltas,
    cascadingPatterns,
    crossHierarchyPatterns,
    patchSuggestions,
  };
}
