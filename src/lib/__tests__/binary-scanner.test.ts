/**
 * Tests for binary scanner PE parsing and pattern matching
 */

import { describe, it, expect } from 'vitest';
import {
  parsePE,
  isExecutableSection,
  BinaryScanner,
  generateCandidatePatterns,
  type PESection,
} from '../binary-scanner.js';

describe('parsePE', () => {
  it('should reject non-PE files', () => {
    const buffer = Buffer.from('not a PE file');
    const result = parsePE(buffer);
    expect(result.valid).toBe(false);
  });

  it('should reject truncated files', () => {
    const buffer = Buffer.from([0x4d, 0x5a]); // Just MZ
    const result = parsePE(buffer);
    expect(result.valid).toBe(false);
  });

  it('should parse minimal valid PE32 header', () => {
    // Create a minimal PE32 structure
    const buffer = Buffer.alloc(512);

    // DOS header
    buffer.writeUInt16LE(0x5a4d, 0); // MZ signature
    buffer.writeUInt32LE(0x80, 0x3c); // PE header offset

    // PE signature
    buffer.writeUInt32LE(0x00004550, 0x80); // PE\0\0

    // COFF header (at 0x84)
    buffer.writeUInt16LE(0x014c, 0x84); // Machine: i386
    buffer.writeUInt16LE(0, 0x86); // NumberOfSections
    buffer.writeUInt16LE(0x70, 0x94); // SizeOfOptionalHeader (112 bytes for PE32)

    // Optional header (at 0x98)
    buffer.writeUInt16LE(0x10b, 0x98); // Magic: PE32
    buffer.writeUInt32LE(0x1000, 0xa8); // EntryPoint
    buffer.writeUInt32LE(0x400000, 0xb4); // ImageBase

    const result = parsePE(buffer);
    expect(result.valid).toBe(true);
    expect(result.is64Bit).toBe(false);
    expect(result.entryPoint).toBe(0x1000);
  });

  it('should parse minimal valid PE32+ (64-bit) header', () => {
    // Create a minimal PE32+ structure
    const buffer = Buffer.alloc(512);

    // DOS header
    buffer.writeUInt16LE(0x5a4d, 0); // MZ signature
    buffer.writeUInt32LE(0x80, 0x3c); // PE header offset

    // PE signature
    buffer.writeUInt32LE(0x00004550, 0x80); // PE\0\0

    // COFF header (at 0x84)
    buffer.writeUInt16LE(0x8664, 0x84); // Machine: AMD64
    buffer.writeUInt16LE(1, 0x86); // NumberOfSections = 1
    buffer.writeUInt16LE(0xf0, 0x94); // SizeOfOptionalHeader (240 bytes for PE32+)

    // Optional header (at 0x98)
    buffer.writeUInt16LE(0x20b, 0x98); // Magic: PE32+
    buffer.writeUInt32LE(0x1000, 0xa8); // EntryPoint
    buffer.writeBigUInt64LE(BigInt(0x140000000), 0xb0); // ImageBase (64-bit)

    // Section header (after optional header)
    const sectionOffset = 0x98 + 0xf0;
    // Name: ".text\0\0\0"
    buffer.write('.text', sectionOffset, 'ascii');
    buffer.writeUInt32LE(0x1000, sectionOffset + 8); // VirtualSize
    buffer.writeUInt32LE(0x1000, sectionOffset + 12); // VirtualAddress
    buffer.writeUInt32LE(0x200, sectionOffset + 16); // RawSize
    buffer.writeUInt32LE(0x200, sectionOffset + 20); // RawAddress
    buffer.writeUInt32LE(0x60000020, sectionOffset + 36); // Characteristics (CODE | EXECUTE | READ)

    const result = parsePE(buffer);
    expect(result.valid).toBe(true);
    expect(result.is64Bit).toBe(true);
    expect(result.imageBase).toBe(BigInt(0x140000000));
    expect(result.sections.length).toBe(1);
    expect(result.sections[0].name).toBe('.text');
  });
});

describe('isExecutableSection', () => {
  it('should identify CODE section as executable', () => {
    const section: PESection = {
      name: '.text',
      virtualAddress: 0x1000,
      virtualSize: 0x1000,
      rawAddress: 0x200,
      rawSize: 0x200,
      characteristics: 0x60000020, // CODE | EXECUTE | READ
    };
    expect(isExecutableSection(section)).toBe(true);
  });

  it('should identify EXECUTE section as executable', () => {
    const section: PESection = {
      name: '.code',
      virtualAddress: 0x1000,
      virtualSize: 0x1000,
      rawAddress: 0x200,
      rawSize: 0x200,
      characteristics: 0x20000000, // EXECUTE only
    };
    expect(isExecutableSection(section)).toBe(true);
  });

  it('should not identify data section as executable', () => {
    const section: PESection = {
      name: '.data',
      virtualAddress: 0x2000,
      virtualSize: 0x1000,
      rawAddress: 0x400,
      rawSize: 0x200,
      characteristics: 0xc0000040, // INITIALIZED_DATA | READ | WRITE
    };
    expect(isExecutableSection(section)).toBe(false);
  });
});

describe('BinaryScanner', () => {
  it('should create from buffer', () => {
    const buffer = Buffer.alloc(64);
    buffer.writeUInt16LE(0x5a4d, 0);
    const scanner = new BinaryScanner(buffer);
    expect(scanner.getBuffer()).toBe(buffer);
  });

  it('should calculate hash', () => {
    const buffer = Buffer.from('test data');
    const scanner = new BinaryScanner(buffer);
    const hash = scanner.getHash();
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('should find pattern in buffer', () => {
    // Create a minimal PE with some data
    const buffer = Buffer.alloc(1024);
    buffer.writeUInt16LE(0x5a4d, 0);
    buffer.writeUInt32LE(0x80, 0x3c);
    buffer.writeUInt32LE(0x00004550, 0x80);
    buffer.writeUInt16LE(0x8664, 0x84);
    buffer.writeUInt16LE(1, 0x86);
    buffer.writeUInt16LE(0xf0, 0x94);
    buffer.writeUInt16LE(0x20b, 0x98);

    // Add a section
    const sectionOffset = 0x98 + 0xf0;
    buffer.write('.text', sectionOffset, 'ascii');
    buffer.writeUInt32LE(0x200, sectionOffset + 8);
    buffer.writeUInt32LE(0x200, sectionOffset + 12);
    buffer.writeUInt32LE(0x200, sectionOffset + 16);
    buffer.writeUInt32LE(0x200, sectionOffset + 20);
    buffer.writeUInt32LE(0x60000020, sectionOffset + 36);

    // Write pattern at offset 0x200
    buffer[0x200] = 0x48;
    buffer[0x201] = 0x8b;
    buffer[0x202] = 0x81;
    buffer[0x203] = 0xa0;
    buffer[0x204] = 0x01;
    buffer[0x205] = 0x00;
    buffer[0x206] = 0x00;

    const scanner = new BinaryScanner(buffer);
    const matches = scanner.findPattern('48 8B 81 A0 01 00 00');
    expect(matches).toContain(0x200);
  });
});

describe('generateCandidatePatterns', () => {
  it('should generate patterns for offset', () => {
    const patterns = generateCandidatePatterns(0x1a0);
    expect(patterns.length).toBeGreaterThan(0);

    // Check at least one pattern contains the offset bytes
    const hasOffsetPattern = patterns.some(p => p.includes('A0 01 00 00'));
    expect(hasOffsetPattern).toBe(true);
  });

  it('should include MOV and LEA patterns', () => {
    const patterns = generateCandidatePatterns(0x100);

    // Should have MOV r64, [r64+disp32]
    const hasMovRead = patterns.some(p => p.startsWith('48 8B'));
    expect(hasMovRead).toBe(true);

    // Should have MOV [r64+disp32], r64
    const hasMovWrite = patterns.some(p => p.startsWith('48 89'));
    expect(hasMovWrite).toBe(true);

    // Should have LEA r64, [r64+disp32]
    const hasLea = patterns.some(p => p.startsWith('48 8D'));
    expect(hasLea).toBe(true);
  });

  it('should include 8-bit displacement patterns for small offsets', () => {
    const patterns = generateCandidatePatterns(0x20);
    // Should have more patterns for small offsets (8-bit displacement)
    expect(patterns.length).toBeGreaterThan(3);
  });

  it('should not include 8-bit displacement for large offsets', () => {
    const patterns = generateCandidatePatterns(0x200);
    // All patterns should use 32-bit displacement
    for (const p of patterns) {
      // Pattern should have 4 offset bytes after the ModR/M byte
      const parts = p.split(' ');
      expect(parts.length).toBeGreaterThanOrEqual(6);
    }
  });
});
