/**
 * Signature types and utilities for automatic offset discovery
 *
 * Signatures are byte patterns extracted from the game binary that reference
 * known struct fields. When a new patch drops, we scan for these patterns
 * to detect where offsets have shifted.
 */

import { toHex } from './types.js';

// ============================================================================
// Signature Types
// ============================================================================

/**
 * Types of signatures we can extract and match
 */
export type SignatureType =
  | 'field_access'    // mov reg, [reg+offset] patterns
  | 'rtti'            // RTTI type descriptor strings
  | 'string_ref'      // Nearby string literal references
  | 'func_prologue'   // Unique function byte patterns
  | 'vtable_ref';     // Virtual table pointer references

/**
 * Base confidence weights by signature type
 */
export const SIGNATURE_TYPE_WEIGHTS: Record<SignatureType, number> = {
  rtti: 99,           // RTTI strings are extremely reliable
  vtable_ref: 95,     // VTable references are very stable
  field_access: 85,   // Field access patterns are reliable
  func_prologue: 80,  // Function prologues can change
  string_ref: 70,     // String refs can be ambiguous
};

/**
 * A single signature for a struct field or vtable entry
 */
export interface Signature {
  /** Type of signature */
  type: SignatureType;

  /** The struct this signature belongs to */
  struct: string;

  /** The field name (or '_vtable' for vtable signatures) */
  field: string;

  /** Expected offset in the struct */
  offset: number;

  /**
   * Byte pattern with wildcards
   * Format: "48 8B 81 ?? ?? ?? ??" where ?? is a wildcard
   */
  pattern: string;

  /**
   * Optional surrounding context bytes for better uniqueness
   * More context = higher confidence but more fragile
   */
  contextBefore?: string;
  contextAfter?: string;

  /** Base confidence score (0-100) */
  confidence: number;

  /** Optional source function name for documentation */
  sourceFunction?: string;

  /** Optional notes about this signature */
  notes?: string;
}

/**
 * Collection of signatures for a struct
 */
export interface StructSignatures {
  /** Struct name */
  struct: string;

  /** Game version these signatures were extracted from */
  version: string;

  /** SHA256 hash of the binary used for extraction */
  binaryHash: string;

  /** Timestamp of extraction */
  extractedAt: string;

  /** Individual signatures */
  signatures: Signature[];
}

/**
 * Result of scanning a binary for a signature
 */
export interface SignatureMatch {
  /** The original signature */
  signature: Signature;

  /** Whether a match was found */
  found: boolean;

  /** File offset where the pattern was found (if any) */
  fileOffset?: number;

  /** The new struct offset extracted from the match */
  newOffset?: number;

  /** Confidence score for this match (0-100) */
  confidence: number;

  /** Number of times this pattern matched in the binary */
  matchCount: number;

  /** Notes about the match */
  notes?: string;
}

/**
 * Detected pattern of changes (e.g., "base class grew +8")
 */
export interface ChangePattern {
  /** Descriptive name for the pattern */
  name: string;

  /** Delta applied (e.g., 8 for +8 bytes) */
  delta: number;

  /** Structs affected by this pattern */
  affectedStructs: string[];

  /** Confidence in this pattern (0-100) */
  confidence: number;

  /** Likely cause of the change */
  likelyCause?: string;
}

/**
 * Individual field change detected
 */
export interface FieldChange {
  struct: string;
  field: string;
  oldOffset: number;
  newOffset: number;
  confidence: number;
  patternGroup?: string;
}

/**
 * Complete scan results
 */
export interface ScanResult {
  /** Path to the scanned binary */
  binary: string;

  /** Detected game version (if determinable) */
  versionDetected?: string;

  /** SHA256 hash of the scanned binary */
  binaryHash: string;

  /** Timestamp of scan */
  scannedAt: string;

  /** Number of signatures that matched */
  signaturesMatched: number;

  /** Number of signatures that didn't match */
  signaturesMissing: number;

  /** Total signatures scanned */
  signaturesTotal: number;

  /** Individual match results */
  matches: SignatureMatch[];

  /** Detected field changes */
  changes: FieldChange[];

  /** Detected patterns (bulk shifts) */
  patternGroups: ChangePattern[];
}

// ============================================================================
// Pattern Parsing and Matching
// ============================================================================

/**
 * Parse a pattern string into bytes and mask
 * "48 8B 81 ?? ?? ?? ??" -> { bytes: [0x48, 0x8B, 0x81, 0, 0, 0, 0], mask: [true, true, true, false, false, false, false] }
 */
export function parsePattern(pattern: string): { bytes: number[]; mask: boolean[] } {
  const parts = pattern.trim().split(/\s+/);
  const bytes: number[] = [];
  const mask: boolean[] = [];

  for (const part of parts) {
    if (part === '??' || part === '?') {
      bytes.push(0);
      mask.push(false);
    } else {
      const value = parseInt(part, 16);
      if (isNaN(value) || value < 0 || value > 255) {
        throw new Error(`Invalid byte in pattern: ${part}`);
      }
      bytes.push(value);
      mask.push(true);
    }
  }

  return { bytes, mask };
}

/**
 * Convert bytes and mask back to pattern string
 */
export function formatPattern(bytes: number[], mask: boolean[]): string {
  return bytes.map((b, i) => mask[i] ? b.toString(16).toUpperCase().padStart(2, '0') : '??').join(' ');
}

/**
 * Check if a buffer matches a pattern at a given offset
 */
export function matchesPattern(
  buffer: Buffer,
  offset: number,
  bytes: number[],
  mask: boolean[]
): boolean {
  if (offset + bytes.length > buffer.length) {
    return false;
  }

  for (let i = 0; i < bytes.length; i++) {
    if (mask[i] && buffer[offset + i] !== bytes[i]) {
      return false;
    }
  }

  return true;
}

/**
 * Find all occurrences of a pattern in a buffer
 */
export function findPattern(buffer: Buffer, pattern: string): number[] {
  const { bytes, mask } = parsePattern(pattern);
  const matches: number[] = [];

  for (let i = 0; i <= buffer.length - bytes.length; i++) {
    if (matchesPattern(buffer, i, bytes, mask)) {
      matches.push(i);
    }
  }

  return matches;
}

/**
 * Extract offset value from a matched pattern
 * Assumes the offset is encoded as a 32-bit little-endian value at the wildcard positions
 */
export function extractOffsetFromMatch(
  buffer: Buffer,
  matchOffset: number,
  pattern: string
): number | null {
  const { mask } = parsePattern(pattern);

  // Find the first wildcard sequence (the offset bytes)
  let wildcardStart = -1;
  let wildcardLength = 0;

  for (let i = 0; i < mask.length; i++) {
    if (!mask[i]) {
      if (wildcardStart === -1) {
        wildcardStart = i;
      }
      wildcardLength++;
    } else if (wildcardStart !== -1) {
      // End of first wildcard sequence
      break;
    }
  }

  if (wildcardStart === -1 || wildcardLength === 0) {
    return null;
  }

  const offsetPosition = matchOffset + wildcardStart;

  // Read the offset value (little-endian)
  if (wildcardLength === 4) {
    return buffer.readInt32LE(offsetPosition);
  } else if (wildcardLength === 2) {
    return buffer.readInt16LE(offsetPosition);
  } else if (wildcardLength === 1) {
    return buffer.readInt8(offsetPosition);
  }

  return null;
}

// ============================================================================
// Confidence Scoring
// ============================================================================

/**
 * Calculate confidence score for a signature match
 */
export function calculateConfidence(
  signature: Signature,
  matchCount: number,
  contextMatched: boolean = false
): number {
  let confidence = SIGNATURE_TYPE_WEIGHTS[signature.type];

  // Penalize multiple matches (less unique = less reliable)
  if (matchCount > 1) {
    // Each additional match reduces confidence
    confidence -= Math.min(30, (matchCount - 1) * 10);
  }

  // Bonus for context matching
  if (contextMatched) {
    confidence += 5;
  }

  // Clamp to 0-100
  return Math.max(0, Math.min(100, confidence));
}

// ============================================================================
// Pattern Detection for Bulk Shifts
// ============================================================================

/**
 * Analyze changes to detect bulk shift patterns
 */
export function detectPatterns(changes: FieldChange[]): ChangePattern[] {
  const patterns: ChangePattern[] = [];

  // Group changes by delta
  const byDelta = new Map<number, FieldChange[]>();
  for (const change of changes) {
    const delta = change.newOffset - change.oldOffset;
    if (!byDelta.has(delta)) {
      byDelta.set(delta, []);
    }
    byDelta.get(delta)!.push(change);
  }

  // Create patterns for deltas with multiple changes
  for (const [delta, deltaChanges] of byDelta) {
    if (deltaChanges.length >= 2 && delta !== 0) {
      const structs = [...new Set(deltaChanges.map((c) => c.struct))];
      const avgConfidence =
        deltaChanges.reduce((sum, c) => sum + c.confidence, 0) / deltaChanges.length;

      patterns.push({
        name: `bulk_shift_${delta >= 0 ? '+' : ''}${toHex(delta)}`,
        delta,
        affectedStructs: structs,
        confidence: Math.round(avgConfidence),
        likelyCause:
          structs.length > 1
            ? 'Possible base class size change'
            : `Fields in ${structs[0]} shifted`,
      });
    }
  }

  // Sort by number of affected structs (most impactful first)
  patterns.sort((a, b) => b.affectedStructs.length - a.affectedStructs.length);

  return patterns;
}

// ============================================================================
// Signature File I/O
// ============================================================================

/**
 * Serialize signatures to YAML-like format
 */
export function serializeSignatures(sigs: StructSignatures): string {
  const lines: string[] = [
    `# Signatures for ${sigs.struct}`,
    `# Extracted from game version ${sigs.version}`,
    `# Generated: ${sigs.extractedAt}`,
    '',
    `struct: ${sigs.struct}`,
    `version: "${sigs.version}"`,
    `binaryHash: "${sigs.binaryHash}"`,
    `extractedAt: "${sigs.extractedAt}"`,
    'signatures:',
  ];

  for (const sig of sigs.signatures) {
    lines.push(`  - type: ${sig.type}`);
    lines.push(`    struct: ${sig.struct}`);
    lines.push(`    field: ${sig.field}`);
    lines.push(`    offset: ${toHex(sig.offset)}`);
    lines.push(`    pattern: "${sig.pattern}"`);
    if (sig.contextBefore) {
      lines.push(`    contextBefore: "${sig.contextBefore}"`);
    }
    if (sig.contextAfter) {
      lines.push(`    contextAfter: "${sig.contextAfter}"`);
    }
    lines.push(`    confidence: ${sig.confidence}`);
    if (sig.sourceFunction) {
      lines.push(`    sourceFunction: "${sig.sourceFunction}"`);
    }
    if (sig.notes) {
      lines.push(`    notes: "${sig.notes}"`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

// ============================================================================
// Common x64 Instruction Patterns
// ============================================================================

/**
 * Common x64 instruction patterns for field access
 * These patterns are used to identify struct field access in disassembled code
 */
export const X64_PATTERNS = {
  // mov reg, [reg+disp32] - common field read
  MOV_REG_MEM_DISP32: {
    prefix: '48 8B', // REX.W prefix + MOV opcode
    description: 'MOV r64, [r64+disp32]',
  },

  // mov [reg+disp32], reg - common field write
  MOV_MEM_REG_DISP32: {
    prefix: '48 89',
    description: 'MOV [r64+disp32], r64',
  },

  // lea reg, [reg+disp32] - address calculation
  LEA_DISP32: {
    prefix: '48 8D',
    description: 'LEA r64, [r64+disp32]',
  },

  // cmp [reg+disp32], imm - field comparison
  CMP_MEM_DISP32: {
    prefix: '48 83',
    description: 'CMP [r64+disp32], imm8',
  },
} as const;

/**
 * Generate a field access pattern for a given offset
 */
export function generateFieldAccessPattern(offset: number): string {
  // Generate a generic MOV pattern with the offset as wildcards
  // The actual pattern depends on which registers are used
  // We use wildcards for the ModR/M byte
  const offsetBytes = [
    (offset & 0xff).toString(16).padStart(2, '0').toUpperCase(),
    ((offset >> 8) & 0xff).toString(16).padStart(2, '0').toUpperCase(),
    ((offset >> 16) & 0xff).toString(16).padStart(2, '0').toUpperCase(),
    ((offset >> 24) & 0xff).toString(16).padStart(2, '0').toUpperCase(),
  ];

  return `48 8B ?? ${offsetBytes.join(' ')}`;
}
