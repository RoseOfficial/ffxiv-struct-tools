/**
 * Type definitions for FFXIVClientStructs YAML format
 */

// ============================================================================
// YAML Input Types (from ffxiv_structs.yml)
// ============================================================================

export interface YamlStruct {
  type: string;
  name?: string;
  size?: number;
  base?: string; // Inheritance - parent struct type
  fields?: YamlField[];
  funcs?: YamlFunc[];
  vfuncs?: YamlVFunc[];
  union?: boolean;
  notes?: string; // Documentation/notes about this struct
  category?: string; // Category for organization (e.g., "UI", "Combat", "Character")
}

export interface YamlField {
  type: string;
  name?: string;
  offset?: string | number;
  size?: number;
  notes?: string; // Documentation/notes about this field
}

export interface YamlFunc {
  name?: string;
  ea?: string | number;
  signature?: string;
}

export interface YamlVFunc {
  name?: string;
  id?: number;
  signature?: string;
}

export interface YamlEnum {
  type: string;
  name?: string;
  underlying?: string;
  values?: Record<string, number | string>;
}

export interface YamlData {
  version?: number;
  structs?: YamlStruct[];
  enums?: YamlEnum[];
}

// ============================================================================
// Validation Types
// ============================================================================

export type ValidationSeverity = 'error' | 'warning' | 'info';

export interface ValidationIssue {
  severity: ValidationSeverity;
  rule: string;
  message: string;
  struct?: string;
  field?: string;
  location?: string;
}

export interface ValidationResult {
  file: string;
  issues: ValidationIssue[];
  stats: {
    structs: number;
    enums: number;
    errors: number;
    warnings: number;
  };
}

export interface ValidationOptions {
  strict?: boolean;
  ignoreRules?: string[];
}

// ============================================================================
// Known Type Sizes (x64)
// ============================================================================

export const TYPE_SIZES: Record<string, number> = {
  // Primitives
  bool: 1,
  byte: 1,
  sbyte: 1,
  char: 1,
  short: 2,
  ushort: 2,
  int: 4,
  uint: 4,
  long: 8,
  ulong: 8,
  float: 4,
  double: 8,

  // C++ equivalents
  __int8: 1,
  __int16: 2,
  __int32: 4,
  __int64: 8,
  unsigned__int8: 1,
  unsigned__int16: 2,
  unsigned__int32: 4,
  unsigned__int64: 8,

  // Common FFXIV types
  Utf8String: 0x68,
  CString: 8, // pointer
  void: 0,
};

// ============================================================================
// Known FFXIV-Specific Type Sizes
// These are FFXIV game engine types with fixed sizes.
// Used for validation and pattern recognition.
// ============================================================================

export const FFXIV_TYPE_SIZES: Record<string, number> = {
  // String types
  'Utf8String': 0x68,
  'CString': 0x8,   // Just a pointer

  // STL containers (FFXIV uses custom implementations with known sizes)
  'StdString': 0x20,
  'StdVector': 0x18,
  'StdMap': 0x10,
  'StdSet': 0x10,
  'StdDeque': 0x28,
  'StdList': 0x10,

  // ATK UI types
  'AtkValue': 0x10,
  'AtkArrayData': 0x20,
  'AtkEventListener': 0x8,  // Just a vtable pointer

  // Math types
  'Vector2': 0x8,
  'Vector3': 0xC,
  'Vector4': 0x10,
  'Matrix4x4': 0x40,
  'Quaternion': 0x10,

  // Lumina/SE types
  'Lumina.Text.SeString': 0x68,
  'SeString': 0x68,

  // Client types
  'ClientObjectId': 0x8,
  'ContentId': 0x8,
  'EntityId': 0x4,
  'ObjectId': 0x4,
};

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Parse a hex string (0x...) or decimal number to a number
 */
export function parseOffset(value: string | number | undefined): number {
  if (value === undefined) return 0;
  if (typeof value === 'number') return value;
  if (value.startsWith('0x') || value.startsWith('0X')) {
    return parseInt(value, 16);
  }
  return parseInt(value, 10);
}

/**
 * Format a number as hex string with 0x prefix
 */
export function toHex(value: number, minWidth = 0): string {
  const hex = value.toString(16).toUpperCase();
  return '0x' + hex.padStart(minWidth, '0');
}

/**
 * Check if a type is a pointer type
 */
export function isPointerType(type: string): boolean {
  return type.endsWith('*') ||
         type.startsWith('Pointer<') ||
         type === 'CString' ||
         type === 'void*';
}

/**
 * Check if a type is an array type
 */
export function isArrayType(type: string): boolean {
  return /\[\d+\]$/.test(type) || type.startsWith('FixedArray<');
}

/**
 * Extract base type from pointer/array type
 */
export function extractBaseType(type: string): string {
  // Handle Pointer<T>
  const pointerMatch = type.match(/^Pointer<(.+)>$/);
  if (pointerMatch) return pointerMatch[1];

  // Handle FixedArray<T, N>
  const fixedArrayMatch = type.match(/^FixedArray<(.+),\s*\d+>$/);
  if (fixedArrayMatch) return fixedArrayMatch[1];

  // Handle StdVector<T>
  const vectorMatch = type.match(/^StdVector<(.+)>$/);
  if (vectorMatch) return vectorMatch[1];

  // Handle T*
  if (type.endsWith('*')) return type.slice(0, -1).trim();

  // Handle T[N]
  const arrayMatch = type.match(/^(.+)\[\d+\]$/);
  if (arrayMatch) return arrayMatch[1];

  return type;
}
