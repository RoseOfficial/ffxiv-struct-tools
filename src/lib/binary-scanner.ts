/**
 * Binary scanner for PE files
 *
 * Provides minimal PE parsing and pattern scanning capabilities
 * for detecting struct field access patterns in game binaries.
 */

import * as fs from 'fs';
import * as crypto from 'crypto';
import {
  Signature,
  SignatureMatch,
  ScanResult,
  FieldChange,
  StructSignatures,
  parsePattern,
  matchesPattern,
  extractOffsetFromMatch,
  calculateConfidence,
  detectPatterns,
} from './signatures.js';

// ============================================================================
// PE File Types
// ============================================================================

/**
 * PE section header information
 */
export interface PESection {
  name: string;
  virtualAddress: number;
  virtualSize: number;
  rawAddress: number;
  rawSize: number;
  characteristics: number;
}

/**
 * Minimal PE file information
 */
export interface PEInfo {
  /** Whether this is a valid PE file */
  valid: boolean;

  /** Whether this is a 64-bit PE (PE32+) */
  is64Bit: boolean;

  /** Image base address */
  imageBase: bigint;

  /** Entry point RVA */
  entryPoint: number;

  /** Sections */
  sections: PESection[];

  /** Optional: detected version string */
  version?: string;
}

// ============================================================================
// PE Section Characteristics
// ============================================================================

const IMAGE_SCN_CNT_CODE = 0x00000020;
const IMAGE_SCN_MEM_EXECUTE = 0x20000000;
const IMAGE_SCN_MEM_READ = 0x40000000;

/**
 * Check if a section contains executable code
 */
export function isExecutableSection(section: PESection): boolean {
  return (
    (section.characteristics & IMAGE_SCN_CNT_CODE) !== 0 ||
    (section.characteristics & IMAGE_SCN_MEM_EXECUTE) !== 0
  );
}

// ============================================================================
// PE Parsing
// ============================================================================

/**
 * Parse PE file headers
 */
export function parsePE(buffer: Buffer): PEInfo {
  const invalid: PEInfo = {
    valid: false,
    is64Bit: false,
    imageBase: BigInt(0),
    entryPoint: 0,
    sections: [],
  };

  // Check MZ signature
  if (buffer.length < 64 || buffer.readUInt16LE(0) !== 0x5a4d) {
    return invalid;
  }

  // Get PE header offset
  const peOffset = buffer.readUInt32LE(0x3c);
  if (peOffset + 24 > buffer.length) {
    return invalid;
  }

  // Check PE signature
  if (buffer.readUInt32LE(peOffset) !== 0x00004550) {
    return invalid;
  }

  // Parse COFF header
  const coffHeader = peOffset + 4;
  const machine = buffer.readUInt16LE(coffHeader);
  const numberOfSections = buffer.readUInt16LE(coffHeader + 2);
  const sizeOfOptionalHeader = buffer.readUInt16LE(coffHeader + 16);

  // Check if 64-bit (AMD64)
  const is64Bit = machine === 0x8664;

  // Parse optional header
  const optionalHeader = coffHeader + 20;
  const magic = buffer.readUInt16LE(optionalHeader);

  // Verify magic matches architecture
  if ((is64Bit && magic !== 0x20b) || (!is64Bit && magic !== 0x10b)) {
    return invalid;
  }

  // Get entry point and image base
  const entryPoint = buffer.readUInt32LE(optionalHeader + 16);
  const imageBase = is64Bit
    ? buffer.readBigUInt64LE(optionalHeader + 24)
    : BigInt(buffer.readUInt32LE(optionalHeader + 28));

  // Parse section headers
  const sectionTableOffset = optionalHeader + sizeOfOptionalHeader;
  const sections: PESection[] = [];

  for (let i = 0; i < numberOfSections; i++) {
    const sectionOffset = sectionTableOffset + i * 40;
    if (sectionOffset + 40 > buffer.length) {
      break;
    }

    // Read section name (8 bytes, null-padded)
    let name = '';
    for (let j = 0; j < 8; j++) {
      const c = buffer[sectionOffset + j];
      if (c === 0) break;
      name += String.fromCharCode(c);
    }

    sections.push({
      name,
      virtualSize: buffer.readUInt32LE(sectionOffset + 8),
      virtualAddress: buffer.readUInt32LE(sectionOffset + 12),
      rawSize: buffer.readUInt32LE(sectionOffset + 16),
      rawAddress: buffer.readUInt32LE(sectionOffset + 20),
      characteristics: buffer.readUInt32LE(sectionOffset + 36),
    });
  }

  return {
    valid: true,
    is64Bit,
    imageBase,
    entryPoint,
    sections,
  };
}

// ============================================================================
// Binary Scanner Class
// ============================================================================

/**
 * Entry in the displacement index
 */
export interface DisplacementEntry {
  /** File offset where this displacement was found */
  fileOffset: number;
  /** The instruction type (mov_read, mov_write, lea) */
  instrType: 'mov_read' | 'mov_write' | 'lea';
  /** Full instruction bytes for pattern matching */
  instrBytes: string;
}

export class BinaryScanner {
  private buffer: Buffer;
  private peInfo: PEInfo;
  private hash: string;
  private displacementIndex: Map<number, DisplacementEntry[]> | null = null;

  constructor(buffer: Buffer) {
    this.buffer = buffer;
    this.peInfo = parsePE(buffer);
    this.hash = crypto.createHash('sha256').update(buffer).digest('hex');
  }

  /**
   * Build an index of all 32-bit displacements in the binary
   * This allows O(1) lookup of field offsets instead of O(n) scanning
   */
  buildDisplacementIndex(): Map<number, DisplacementEntry[]> {
    if (this.displacementIndex) {
      return this.displacementIndex;
    }

    const index = new Map<number, DisplacementEntry[]>();
    const execSections = this.peInfo.sections.filter(isExecutableSection);

    for (const section of execSections) {
      const start = section.rawAddress;
      const end = Math.min(start + section.rawSize, this.buffer.length - 7);

      for (let i = start; i < end; i++) {
        // Check for REX.W prefix (48)
        if (this.buffer[i] !== 0x48) continue;

        const opcode = this.buffer[i + 1];
        const modrm = this.buffer[i + 2];

        // Check for MOV r64, [r64+disp32] (8B) or MOV [r64+disp32], r64 (89) or LEA (8D)
        if (opcode !== 0x8b && opcode !== 0x89 && opcode !== 0x8d) continue;

        // ModR/M byte: mod=10 (2 bits), reg (3 bits), rm (3 bits)
        // mod=10 means [reg + disp32]
        const mod = (modrm >> 6) & 0x03;
        const rm = modrm & 0x07;

        // mod=10 means 32-bit displacement, rm != 4 (no SIB byte)
        if (mod !== 0x02 || rm === 0x04) continue;

        // Read the 32-bit displacement
        const disp = this.buffer.readInt32LE(i + 3);

        // Only index positive displacements (struct field offsets are positive)
        if (disp < 0 || disp > 0x100000) continue;

        const instrType = opcode === 0x8b ? 'mov_read' : opcode === 0x89 ? 'mov_write' : 'lea';
        const instrBytes = this.buffer.slice(i, i + 7).toString('hex').toUpperCase();

        const entry: DisplacementEntry = {
          fileOffset: i,
          instrType,
          instrBytes,
        };

        if (!index.has(disp)) {
          index.set(disp, []);
        }
        index.get(disp)!.push(entry);
      }
    }

    this.displacementIndex = index;
    return index;
  }

  /**
   * Look up a field offset in the displacement index
   * Much faster than scanning the entire binary for each offset
   */
  lookupOffset(offset: number): DisplacementEntry[] {
    const index = this.buildDisplacementIndex();
    return index.get(offset) || [];
  }

  /**
   * Get statistics about the displacement index
   */
  getIndexStats(): { uniqueOffsets: number; totalEntries: number; topOffsets: Array<{ offset: number; count: number }> } {
    const index = this.buildDisplacementIndex();
    let totalEntries = 0;
    const counts: Array<{ offset: number; count: number }> = [];

    for (const [offset, entries] of index) {
      totalEntries += entries.length;
      counts.push({ offset, count: entries.length });
    }

    counts.sort((a, b) => b.count - a.count);

    return {
      uniqueOffsets: index.size,
      totalEntries,
      topOffsets: counts.slice(0, 20),
    };
  }

  /**
   * Load a binary from disk
   */
  static fromFile(path: string): BinaryScanner {
    const buffer = fs.readFileSync(path);
    return new BinaryScanner(buffer);
  }

  /**
   * Get PE file information
   */
  getPEInfo(): PEInfo {
    return this.peInfo;
  }

  /**
   * Get SHA256 hash of the binary
   */
  getHash(): string {
    return this.hash;
  }

  /**
   * Get the raw buffer
   */
  getBuffer(): Buffer {
    return this.buffer;
  }

  /**
   * Convert RVA (relative virtual address) to file offset
   */
  rvaToOffset(rva: number): number | null {
    for (const section of this.peInfo.sections) {
      if (
        rva >= section.virtualAddress &&
        rva < section.virtualAddress + section.virtualSize
      ) {
        return section.rawAddress + (rva - section.virtualAddress);
      }
    }
    return null;
  }

  /**
   * Convert file offset to RVA
   */
  offsetToRva(offset: number): number | null {
    for (const section of this.peInfo.sections) {
      if (
        offset >= section.rawAddress &&
        offset < section.rawAddress + section.rawSize
      ) {
        return section.virtualAddress + (offset - section.rawAddress);
      }
    }
    return null;
  }

  /**
   * Find all occurrences of a pattern in executable sections
   */
  findPattern(pattern: string, executableOnly: boolean = true): number[] {
    const { bytes, mask } = parsePattern(pattern);
    const matches: number[] = [];

    const sectionsToSearch = executableOnly
      ? this.peInfo.sections.filter(isExecutableSection)
      : this.peInfo.sections;

    for (const section of sectionsToSearch) {
      const start = section.rawAddress;
      const end = Math.min(start + section.rawSize, this.buffer.length);

      for (let i = start; i <= end - bytes.length; i++) {
        if (matchesPattern(this.buffer, i, bytes, mask)) {
          matches.push(i);
        }
      }
    }

    return matches;
  }

  /**
   * Find all strings matching a pattern (for RTTI detection)
   */
  findStrings(searchPattern: string | RegExp): Array<{ offset: number; value: string }> {
    const results: Array<{ offset: number; value: string }> = [];
    const regex =
      typeof searchPattern === 'string' ? new RegExp(searchPattern, 'g') : searchPattern;

    // Search in all readable sections
    for (const section of this.peInfo.sections) {
      const start = section.rawAddress;
      const end = Math.min(start + section.rawSize, this.buffer.length);

      // Extract ASCII strings (simple approach)
      let currentString = '';
      let stringStart = -1;

      for (let i = start; i < end; i++) {
        const c = this.buffer[i];
        // Printable ASCII
        if (c >= 0x20 && c < 0x7f) {
          if (stringStart === -1) {
            stringStart = i;
          }
          currentString += String.fromCharCode(c);
        } else {
          if (currentString.length >= 4) {
            // Minimum string length
            if (regex.test(currentString)) {
              results.push({ offset: stringStart, value: currentString });
            }
          }
          currentString = '';
          stringStart = -1;
        }
      }
    }

    return results;
  }

  /**
   * Match a single signature and return the result
   */
  matchSignature(signature: Signature): SignatureMatch {
    const matches = this.findPattern(signature.pattern);

    if (matches.length === 0) {
      return {
        signature,
        found: false,
        confidence: 0,
        matchCount: 0,
        notes: 'Pattern not found in binary',
      };
    }

    // For now, use the first match
    // TODO: Use context to disambiguate multiple matches
    const matchOffset = matches[0];
    const newOffset = extractOffsetFromMatch(this.buffer, matchOffset, signature.pattern);

    const confidence = calculateConfidence(signature, matches.length);

    return {
      signature,
      found: true,
      fileOffset: matchOffset,
      newOffset: newOffset ?? undefined,
      confidence,
      matchCount: matches.length,
      notes:
        matches.length > 1
          ? `Multiple matches found (${matches.length}), using first occurrence`
          : undefined,
    };
  }

  /**
   * Scan for all signatures and return results
   */
  scan(signatureCollections: StructSignatures[]): ScanResult {
    const allSignatures: Signature[] = [];
    for (const collection of signatureCollections) {
      allSignatures.push(...collection.signatures);
    }

    const matches: SignatureMatch[] = [];
    const changes: FieldChange[] = [];

    for (const sig of allSignatures) {
      const match = this.matchSignature(sig);
      matches.push(match);

      // Record changes
      if (match.found && match.newOffset !== undefined && match.newOffset !== sig.offset) {
        changes.push({
          struct: sig.struct,
          field: sig.field,
          oldOffset: sig.offset,
          newOffset: match.newOffset,
          confidence: match.confidence,
        });
      }
    }

    const patterns = detectPatterns(changes);

    // Assign pattern groups to changes
    for (const change of changes) {
      const delta = change.newOffset - change.oldOffset;
      const matchingPattern = patterns.find((p) => p.delta === delta);
      if (matchingPattern) {
        change.patternGroup = matchingPattern.name;
      }
    }

    const matched = matches.filter((m) => m.found).length;
    const missing = matches.filter((m) => !m.found).length;

    return {
      binary: 'unknown', // Set by caller
      binaryHash: this.hash,
      scannedAt: new Date().toISOString(),
      signaturesMatched: matched,
      signaturesMissing: missing,
      signaturesTotal: allSignatures.length,
      matches,
      changes,
      patternGroups: patterns,
    };
  }
}

// ============================================================================
// Signature Extraction Helpers
// ============================================================================

/**
 * Common field access instruction patterns for x64
 * These help identify what instruction patterns to look for
 */
export const FIELD_ACCESS_PATTERNS = {
  // mov r64, [r64 + disp32] (REX.W prefix)
  MOV_R64_MEM: /^48 8[bB] [89a-fA-F][0-9a-fA-F]/,

  // mov [r64 + disp32], r64
  MOV_MEM_R64: /^48 89 [89a-fA-F][0-9a-fA-F]/,

  // lea r64, [r64 + disp32]
  LEA_R64: /^48 8[dD] [89a-fA-F][0-9a-fA-F]/,
} as const;

/**
 * Generate candidate patterns for a field offset
 * Returns patterns that might access a field at the given offset
 */
export function generateCandidatePatterns(offset: number): string[] {
  const patterns: string[] = [];

  // Encode offset as little-endian bytes
  const b0 = (offset & 0xff).toString(16).padStart(2, '0').toUpperCase();
  const b1 = ((offset >> 8) & 0xff).toString(16).padStart(2, '0').toUpperCase();
  const b2 = ((offset >> 16) & 0xff).toString(16).padStart(2, '0').toUpperCase();
  const b3 = ((offset >> 24) & 0xff).toString(16).padStart(2, '0').toUpperCase();

  // Pattern for mov r64, [r64 + disp32]
  // 48 8B ModR/M offset32
  // ModR/M byte: 10 xxx yyy where xxx is dest reg, yyy is base reg
  // For [rcx + disp32]: ModR/M = 0x81-0x87, 0x89-0x8F, etc.
  patterns.push(`48 8B ?? ${b0} ${b1} ${b2} ${b3}`);

  // Pattern for mov [r64 + disp32], r64
  patterns.push(`48 89 ?? ${b0} ${b1} ${b2} ${b3}`);

  // Pattern for lea r64, [r64 + disp32]
  patterns.push(`48 8D ?? ${b0} ${b1} ${b2} ${b3}`);

  // Also check for smaller offsets (8-bit displacement if offset < 128)
  if (offset < 128 && offset >= -128) {
    const b = (offset & 0xff).toString(16).padStart(2, '0').toUpperCase();
    patterns.push(`48 8B ?? ${b}`);
    patterns.push(`48 89 ?? ${b}`);
    patterns.push(`48 8D ?? ${b}`);
  }

  return patterns;
}

/**
 * Try to detect FFXIV game version from binary strings
 */
export function detectGameVersion(scanner: BinaryScanner): string | undefined {
  // Look for version strings in the binary
  // FFXIV typically has strings like "6.5" or "7.0" in various places
  const versionStrings = scanner.findStrings(/^\d+\.\d+[a-z]?$/);

  // Also look for build date strings
  const buildDates = scanner.findStrings(/20\d{2}\.\d{2}\.\d{2}/);

  // The game version is often near "FINAL FANTASY XIV" string
  const ffxivStrings = scanner.findStrings(/FINAL FANTASY XIV/);

  // Return first plausible version string found
  for (const vs of versionStrings) {
    const match = vs.value.match(/^(\d+\.\d+[a-z]?)$/);
    if (match) {
      return match[1];
    }
  }

  return undefined;
}
