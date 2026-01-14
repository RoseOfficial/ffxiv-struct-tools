/**
 * Tests for signature types and utilities
 */

import { describe, it, expect } from 'vitest';
import {
  parsePattern,
  formatPattern,
  matchesPattern,
  extractOffsetFromMatch,
  findPattern,
  calculateConfidence,
  detectPatterns,
  generateFieldAccessPattern,
  SIGNATURE_TYPE_WEIGHTS,
  type FieldChange,
} from '../signatures.js';

describe('parsePattern', () => {
  it('should parse a simple byte pattern', () => {
    const result = parsePattern('48 8B 81');
    expect(result.bytes).toEqual([0x48, 0x8b, 0x81]);
    expect(result.mask).toEqual([true, true, true]);
  });

  it('should parse wildcards', () => {
    const result = parsePattern('48 ?? 81');
    expect(result.bytes).toEqual([0x48, 0, 0x81]);
    expect(result.mask).toEqual([true, false, true]);
  });

  it('should parse mixed pattern', () => {
    const result = parsePattern('48 8B ?? ?? ?? ?? ??');
    expect(result.bytes).toEqual([0x48, 0x8b, 0, 0, 0, 0, 0]);
    expect(result.mask).toEqual([true, true, false, false, false, false, false]);
  });

  it('should handle single-char wildcards', () => {
    const result = parsePattern('48 ? 81');
    expect(result.mask).toEqual([true, false, true]);
  });

  it('should throw on invalid byte', () => {
    expect(() => parsePattern('48 GG 81')).toThrow('Invalid byte in pattern');
  });

  it('should throw on out of range byte', () => {
    expect(() => parsePattern('48 100 81')).toThrow('Invalid byte in pattern');
  });
});

describe('formatPattern', () => {
  it('should format bytes to pattern string', () => {
    const bytes = [0x48, 0x8b, 0x81];
    const mask = [true, true, true];
    expect(formatPattern(bytes, mask)).toBe('48 8B 81');
  });

  it('should format wildcards', () => {
    const bytes = [0x48, 0, 0x81];
    const mask = [true, false, true];
    expect(formatPattern(bytes, mask)).toBe('48 ?? 81');
  });
});

describe('matchesPattern', () => {
  it('should match exact bytes', () => {
    const buffer = Buffer.from([0x48, 0x8b, 0x81, 0xa0, 0x01, 0x00, 0x00]);
    const { bytes, mask } = parsePattern('48 8B 81');
    expect(matchesPattern(buffer, 0, bytes, mask)).toBe(true);
  });

  it('should match with wildcards', () => {
    const buffer = Buffer.from([0x48, 0x8b, 0x81, 0xa0, 0x01, 0x00, 0x00]);
    const { bytes, mask } = parsePattern('48 ?? 81');
    expect(matchesPattern(buffer, 0, bytes, mask)).toBe(true);
  });

  it('should not match different bytes', () => {
    const buffer = Buffer.from([0x48, 0x8b, 0x81, 0xa0, 0x01, 0x00, 0x00]);
    const { bytes, mask } = parsePattern('48 8B 82');
    expect(matchesPattern(buffer, 0, bytes, mask)).toBe(false);
  });

  it('should match at offset', () => {
    const buffer = Buffer.from([0x00, 0x00, 0x48, 0x8b, 0x81]);
    const { bytes, mask } = parsePattern('48 8B 81');
    expect(matchesPattern(buffer, 2, bytes, mask)).toBe(true);
  });

  it('should return false if pattern extends past buffer', () => {
    const buffer = Buffer.from([0x48, 0x8b]);
    const { bytes, mask } = parsePattern('48 8B 81');
    expect(matchesPattern(buffer, 0, bytes, mask)).toBe(false);
  });
});

describe('findPattern', () => {
  it('should find pattern in buffer', () => {
    const buffer = Buffer.from([0x00, 0x48, 0x8b, 0x81, 0x00]);
    const matches = findPattern(buffer, '48 8B 81');
    expect(matches).toEqual([1]);
  });

  it('should find multiple occurrences', () => {
    const buffer = Buffer.from([0x48, 0x8b, 0x81, 0x00, 0x48, 0x8b, 0x81]);
    const matches = findPattern(buffer, '48 8B 81');
    expect(matches).toEqual([0, 4]);
  });

  it('should return empty array if not found', () => {
    const buffer = Buffer.from([0x00, 0x00, 0x00]);
    const matches = findPattern(buffer, '48 8B 81');
    expect(matches).toEqual([]);
  });

  it('should find pattern with wildcards', () => {
    const buffer = Buffer.from([0x48, 0x8b, 0x81, 0xa0, 0x01, 0x00, 0x00]);
    const matches = findPattern(buffer, '48 8B ?? ?? ?? ?? ??');
    expect(matches).toEqual([0]);
  });
});

describe('extractOffsetFromMatch', () => {
  it('should extract 32-bit offset from wildcards', () => {
    // Pattern: 48 8B 81 offset32 where offset32 = 0x1A0 (ModR/M byte is fixed)
    const buffer = Buffer.from([0x48, 0x8b, 0x81, 0xa0, 0x01, 0x00, 0x00]);
    const offset = extractOffsetFromMatch(buffer, 0, '48 8B 81 ?? ?? ?? ??');
    expect(offset).toBe(0x1a0);
  });

  it('should return null if no wildcards', () => {
    const buffer = Buffer.from([0x48, 0x8b, 0x81]);
    const offset = extractOffsetFromMatch(buffer, 0, '48 8B 81');
    expect(offset).toBeNull();
  });

  it('should handle larger offsets', () => {
    // 0x12345678 in little-endian (ModR/M byte is fixed)
    const buffer = Buffer.from([0x48, 0x8b, 0x81, 0x78, 0x56, 0x34, 0x12]);
    const offset = extractOffsetFromMatch(buffer, 0, '48 8B 81 ?? ?? ?? ??');
    expect(offset).toBe(0x12345678);
  });
});

describe('calculateConfidence', () => {
  it('should return base confidence for single match', () => {
    const sig = {
      type: 'field_access' as const,
      struct: 'Test',
      field: 'test',
      offset: 0x100,
      pattern: '48 8B ??',
      confidence: 85,
    };
    const confidence = calculateConfidence(sig, 1);
    expect(confidence).toBe(SIGNATURE_TYPE_WEIGHTS.field_access);
  });

  it('should reduce confidence for multiple matches', () => {
    const sig = {
      type: 'field_access' as const,
      struct: 'Test',
      field: 'test',
      offset: 0x100,
      pattern: '48 8B ??',
      confidence: 85,
    };
    const confidence = calculateConfidence(sig, 3);
    expect(confidence).toBeLessThan(SIGNATURE_TYPE_WEIGHTS.field_access);
  });

  it('should have higher base confidence for RTTI', () => {
    const sig = {
      type: 'rtti' as const,
      struct: 'Test',
      field: '_rtti',
      offset: 0,
      pattern: 'Test@@',
      confidence: 99,
    };
    const confidence = calculateConfidence(sig, 1);
    expect(confidence).toBe(SIGNATURE_TYPE_WEIGHTS.rtti);
    expect(confidence).toBeGreaterThan(SIGNATURE_TYPE_WEIGHTS.field_access);
  });

  it('should increase confidence for context match', () => {
    const sig = {
      type: 'field_access' as const,
      struct: 'Test',
      field: 'test',
      offset: 0x100,
      pattern: '48 8B ??',
      confidence: 85,
    };
    const withContext = calculateConfidence(sig, 1, true);
    const withoutContext = calculateConfidence(sig, 1, false);
    expect(withContext).toBeGreaterThan(withoutContext);
  });

  it('should clamp confidence to 0-100', () => {
    const sig = {
      type: 'field_access' as const,
      struct: 'Test',
      field: 'test',
      offset: 0x100,
      pattern: '48 8B ??',
      confidence: 85,
    };
    // Many matches should reduce confidence but not below 0
    const confidence = calculateConfidence(sig, 100);
    expect(confidence).toBeGreaterThanOrEqual(0);
    expect(confidence).toBeLessThanOrEqual(100);
  });
});

describe('detectPatterns', () => {
  it('should detect bulk shift pattern', () => {
    const changes: FieldChange[] = [
      { struct: 'A', field: 'f1', oldOffset: 0x100, newOffset: 0x108, confidence: 90 },
      { struct: 'A', field: 'f2', oldOffset: 0x200, newOffset: 0x208, confidence: 90 },
      { struct: 'B', field: 'f1', oldOffset: 0x50, newOffset: 0x58, confidence: 90 },
    ];

    const patterns = detectPatterns(changes);
    expect(patterns.length).toBe(1);
    expect(patterns[0].delta).toBe(8);
    expect(patterns[0].affectedStructs).toContain('A');
    expect(patterns[0].affectedStructs).toContain('B');
  });

  it('should not create pattern for single change', () => {
    const changes: FieldChange[] = [
      { struct: 'A', field: 'f1', oldOffset: 0x100, newOffset: 0x108, confidence: 90 },
    ];

    const patterns = detectPatterns(changes);
    expect(patterns.length).toBe(0);
  });

  it('should detect multiple patterns', () => {
    const changes: FieldChange[] = [
      { struct: 'A', field: 'f1', oldOffset: 0x100, newOffset: 0x108, confidence: 90 },
      { struct: 'A', field: 'f2', oldOffset: 0x200, newOffset: 0x208, confidence: 90 },
      { struct: 'B', field: 'f1', oldOffset: 0x50, newOffset: 0x60, confidence: 90 },
      { struct: 'B', field: 'f2', oldOffset: 0x60, newOffset: 0x70, confidence: 90 },
    ];

    const patterns = detectPatterns(changes);
    expect(patterns.length).toBe(2);
    const deltas = patterns.map(p => p.delta).sort((a, b) => a - b);
    expect(deltas).toEqual([8, 16]);
  });

  it('should ignore zero delta', () => {
    const changes: FieldChange[] = [
      { struct: 'A', field: 'f1', oldOffset: 0x100, newOffset: 0x100, confidence: 90 },
      { struct: 'A', field: 'f2', oldOffset: 0x200, newOffset: 0x200, confidence: 90 },
    ];

    const patterns = detectPatterns(changes);
    expect(patterns.length).toBe(0);
  });

  it('should sort patterns by affected struct count', () => {
    const changes: FieldChange[] = [
      // Pattern 1: delta +8, affects 3 structs
      { struct: 'A', field: 'f1', oldOffset: 0x100, newOffset: 0x108, confidence: 90 },
      { struct: 'B', field: 'f1', oldOffset: 0x100, newOffset: 0x108, confidence: 90 },
      { struct: 'C', field: 'f1', oldOffset: 0x100, newOffset: 0x108, confidence: 90 },
      // Pattern 2: delta +16, affects 2 structs
      { struct: 'D', field: 'f1', oldOffset: 0x100, newOffset: 0x110, confidence: 90 },
      { struct: 'E', field: 'f1', oldOffset: 0x100, newOffset: 0x110, confidence: 90 },
    ];

    const patterns = detectPatterns(changes);
    expect(patterns.length).toBe(2);
    expect(patterns[0].delta).toBe(8); // Most affected first
    expect(patterns[0].affectedStructs.length).toBe(3);
  });
});

describe('generateFieldAccessPattern', () => {
  it('should generate pattern for small offset', () => {
    const pattern = generateFieldAccessPattern(0x1a0);
    expect(pattern).toContain('A0 01 00 00');
  });

  it('should generate pattern for large offset', () => {
    const pattern = generateFieldAccessPattern(0x12345678);
    expect(pattern).toContain('78 56 34 12');
  });

  it('should include MOV prefix', () => {
    const pattern = generateFieldAccessPattern(0x100);
    expect(pattern.startsWith('48 8B')).toBe(true);
  });
});
