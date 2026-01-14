/**
 * Validation rules for FFXIVClientStructs YAML definitions
 */

import type {
  YamlStruct,
  YamlField,
  YamlEnum,
  ValidationIssue,
  ValidationOptions,
} from './types.js';
import {
  parseOffset,
  toHex,
  isPointerType,
  TYPE_SIZES,
  extractBaseType,
} from './types.js';

type ValidatorFn = (
  struct: YamlStruct,
  context: ValidationContext
) => ValidationIssue[];

interface ValidationContext {
  allStructNames: Set<string>;
  allEnumNames: Set<string>;
  options: ValidationOptions;
}

// ============================================================================
// Individual Validation Rules
// ============================================================================

/**
 * Rule: Field offsets should be ascending (or equal for unions)
 */
export function validateFieldOffsetOrder(
  struct: YamlStruct,
  context: ValidationContext
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!struct.fields || struct.fields.length < 2) return issues;
  if (struct.union) return issues; // Unions can have overlapping offsets

  let prevOffset = -1;
  let prevFieldName = '';

  for (const field of struct.fields) {
    const offset = parseOffset(field.offset);
    if (offset < prevOffset) {
      issues.push({
        severity: 'warning',
        rule: 'field-offset-order',
        message: `Field '${field.name || field.type}' at ${toHex(offset)} comes before previous field '${prevFieldName}' at ${toHex(prevOffset)}`,
        struct: struct.type,
        field: field.name || field.type,
      });
    }
    prevOffset = offset;
    prevFieldName = field.name || field.type;
  }

  return issues;
}

/**
 * Rule: Field offset + size should not exceed struct size
 */
export function validateFieldBounds(
  struct: YamlStruct,
  context: ValidationContext
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!struct.fields || !struct.size) return issues;

  for (const field of struct.fields) {
    const offset = parseOffset(field.offset);
    const fieldSize = estimateFieldSize(field, context);

    if (fieldSize > 0 && offset + fieldSize > struct.size) {
      issues.push({
        severity: 'error',
        rule: 'field-bounds',
        message: `Field '${field.name || field.type}' at ${toHex(offset)} with size ${toHex(fieldSize)} exceeds struct size ${toHex(struct.size)}`,
        struct: struct.type,
        field: field.name || field.type,
      });
    }
  }

  return issues;
}

/**
 * Rule: Struct size should be a multiple of 8 (typical alignment)
 */
export function validateStructAlignment(
  struct: YamlStruct,
  context: ValidationContext
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!struct.size) return issues;

  // Only warn if strict mode - many structs have odd sizes due to packing
  if (context.options.strict && struct.size % 8 !== 0) {
    issues.push({
      severity: 'info',
      rule: 'struct-alignment',
      message: `Struct size ${toHex(struct.size)} is not 8-byte aligned`,
      struct: struct.type,
    });
  }

  return issues;
}

/**
 * Rule: Pointer fields should be 8 bytes on x64
 * Note: In FFXIVClientStructs format, field.size often represents array element count,
 * not byte size. So we skip this check when size is present (it's an array of pointers).
 */
export function validatePointerSizes(
  struct: YamlStruct,
  context: ValidationContext
): ValidationIssue[] {
  // In FFXIVClientStructs YAML format, the `size` field on a field typically
  // represents array count, not byte size. So if a pointer field has size > 1,
  // it's likely an array of pointers, which is valid.
  // We skip this validation as it produces too many false positives.
  return [];
}

/**
 * Rule: Referenced struct types should exist
 */
export function validateTypeReferences(
  struct: YamlStruct,
  context: ValidationContext
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!struct.fields) return issues;

  const knownTypes = new Set([
    ...Object.keys(TYPE_SIZES),
    ...context.allStructNames,
    ...context.allEnumNames,
  ]);

  for (const field of struct.fields) {
    const baseType = extractBaseType(field.type);

    // Skip if it's a known primitive, template, or self-reference
    if (
      knownTypes.has(baseType) ||
      baseType === struct.type ||
      baseType === 'void' ||
      baseType.includes('::') // Namespaced types we can't fully resolve
    ) {
      continue;
    }

    // Only report in strict mode - many types are external
    if (context.options.strict) {
      issues.push({
        severity: 'info',
        rule: 'type-reference',
        message: `Field type '${baseType}' is not a known struct or enum`,
        struct: struct.type,
        field: field.name || field.type,
      });
    }
  }

  return issues;
}

/**
 * Rule: Vtable addresses should be valid hex
 */
export function validateVtableAddresses(
  struct: YamlStruct,
  context: ValidationContext
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!struct.vfuncs) return issues;

  for (const vfunc of struct.vfuncs) {
    if (vfunc.id !== undefined && (vfunc.id < 0 || vfunc.id > 1000)) {
      issues.push({
        severity: 'warning',
        rule: 'vfunc-id',
        message: `Virtual function '${vfunc.name || 'unnamed'}' has unusual id ${vfunc.id}`,
        struct: struct.type,
      });
    }
  }

  return issues;
}

/**
 * Rule: Function addresses should be valid hex
 */
export function validateFunctionAddresses(
  struct: YamlStruct,
  context: ValidationContext
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!struct.funcs) return issues;

  for (const func of struct.funcs) {
    if (func.ea) {
      const addr = parseOffset(func.ea);
      // Typical FFXIV addresses are in the 0x140000000+ range
      if (addr !== 0 && addr < 0x100000000) {
        issues.push({
          severity: 'info',
          rule: 'func-address',
          message: `Function '${func.name || 'unnamed'}' has unusual address ${toHex(addr)}`,
          struct: struct.type,
        });
      }
    }
  }

  return issues;
}

/**
 * Rule: Struct should have a name/type
 */
export function validateStructName(
  struct: YamlStruct,
  context: ValidationContext
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (!struct.type) {
    issues.push({
      severity: 'error',
      rule: 'struct-name',
      message: 'Struct is missing type/name',
      struct: '<unnamed>',
    });
  }

  return issues;
}

/**
 * Rule: Struct should have a size
 */
export function validateStructSize(
  struct: YamlStruct,
  context: ValidationContext
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (!struct.size || struct.size <= 0) {
    issues.push({
      severity: 'warning',
      rule: 'struct-size',
      message: 'Struct is missing size or has size 0',
      struct: struct.type,
    });
  }

  return issues;
}

/**
 * Rule: Fields should not have duplicate offsets (unless union)
 */
export function validateDuplicateOffsets(
  struct: YamlStruct,
  context: ValidationContext
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!struct.fields || struct.union) return issues;

  const seenOffsets = new Map<number, string>();

  for (const field of struct.fields) {
    const offset = parseOffset(field.offset);
    const fieldName = field.name || field.type;

    if (seenOffsets.has(offset)) {
      // This might be intentional (union-like behavior) so just info
      issues.push({
        severity: 'info',
        rule: 'duplicate-offset',
        message: `Field '${fieldName}' has same offset ${toHex(offset)} as '${seenOffsets.get(offset)}'`,
        struct: struct.type,
        field: fieldName,
      });
    } else {
      seenOffsets.set(offset, fieldName);
    }
  }

  return issues;
}

/**
 * Rule: Inheritance chain should reference existing structs
 */
export function validateInheritanceChain(
  struct: YamlStruct,
  context: ValidationContext
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!struct.base) return issues;

  // Check if base struct exists
  if (!context.allStructNames.has(struct.base)) {
    issues.push({
      severity: 'warning',
      rule: 'inheritance-chain',
      message: `Base struct '${struct.base}' is not defined in the current file set`,
      struct: struct.type,
    });
  }

  // Check for circular inheritance (self-reference)
  if (struct.base === struct.type) {
    issues.push({
      severity: 'error',
      rule: 'inheritance-chain',
      message: `Struct inherits from itself`,
      struct: struct.type,
    });
  }

  return issues;
}

/**
 * Rule: Virtual function IDs should be sequential and reasonable
 */
export function validateVTableConsistency(
  struct: YamlStruct,
  context: ValidationContext
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!struct.vfuncs || struct.vfuncs.length === 0) return issues;

  // Collect all vfunc IDs
  const vfuncIds: { id: number; name: string }[] = [];
  for (const vfunc of struct.vfuncs) {
    if (vfunc.id !== undefined) {
      vfuncIds.push({ id: vfunc.id, name: vfunc.name || '<unnamed>' });
    }
  }

  if (vfuncIds.length === 0) return issues;

  // Sort by ID
  vfuncIds.sort((a, b) => a.id - b.id);

  // Check for duplicate IDs
  const seenIds = new Map<number, string>();
  for (const { id, name } of vfuncIds) {
    if (seenIds.has(id)) {
      issues.push({
        severity: 'error',
        rule: 'vtable-consistency',
        message: `VFunc '${name}' has duplicate id ${id} (same as '${seenIds.get(id)}')`,
        struct: struct.type,
      });
    } else {
      seenIds.set(id, name);
    }
  }

  // Check for gaps in ID sequence (warning, not error - may be intentional)
  for (let i = 1; i < vfuncIds.length; i++) {
    const gap = vfuncIds[i].id - vfuncIds[i - 1].id;
    if (gap > 1) {
      issues.push({
        severity: 'info',
        rule: 'vtable-consistency',
        message: `VTable has gap: id ${vfuncIds[i - 1].id} to ${vfuncIds[i].id} (missing ${gap - 1} slot${gap > 2 ? 's' : ''})`,
        struct: struct.type,
      });
    }
  }

  return issues;
}

/**
 * Rule: Pointer fields should be at 8-byte aligned offsets (x64)
 */
export function validatePointerAlignment(
  struct: YamlStruct,
  context: ValidationContext
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!struct.fields) return issues;

  // Only check in strict mode - many packed structs intentionally misalign
  if (!context.options.strict) return issues;

  for (const field of struct.fields) {
    if (!isPointerType(field.type)) continue;

    const offset = parseOffset(field.offset);
    if (offset % 8 !== 0) {
      issues.push({
        severity: 'warning',
        rule: 'pointer-alignment',
        message: `Pointer field '${field.name || field.type}' at ${toHex(offset)} is not 8-byte aligned`,
        struct: struct.type,
        field: field.name || field.type,
      });
    }
  }

  return issues;
}

/**
 * Rule: Declared struct size should match calculated size from fields
 */
export function validateSizeFieldMismatch(
  struct: YamlStruct,
  context: ValidationContext
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!struct.fields || struct.fields.length === 0 || !struct.size) return issues;

  // Find the highest field end position
  let maxFieldEnd = 0;
  for (const field of struct.fields) {
    const offset = parseOffset(field.offset);
    const fieldSize = estimateFieldSizeForValidation(field, context);

    if (fieldSize > 0) {
      const fieldEnd = offset + fieldSize;
      if (fieldEnd > maxFieldEnd) {
        maxFieldEnd = fieldEnd;
      }
    }
  }

  // If we couldn't calculate any field sizes, skip
  if (maxFieldEnd === 0) return issues;

  // Check if declared size is less than required size
  if (struct.size < maxFieldEnd) {
    issues.push({
      severity: 'error',
      rule: 'size-field-mismatch',
      message: `Declared size ${toHex(struct.size)} is less than calculated minimum ${toHex(maxFieldEnd)} from fields`,
      struct: struct.type,
    });
  }

  // Info if there's a large gap (might indicate missing fields)
  const gap = struct.size - maxFieldEnd;
  if (gap > 0x100 && context.options.strict) {
    issues.push({
      severity: 'info',
      rule: 'size-field-mismatch',
      message: `Large gap of ${toHex(gap)} bytes between last field and struct size (may indicate missing fields)`,
      struct: struct.type,
    });
  }

  return issues;
}

/**
 * Rule: Naming conventions - PascalCase for structs/enums, camelCase for fields
 */
export function validateNamingConvention(
  struct: YamlStruct,
  context: ValidationContext
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  // Only check in strict mode
  if (!context.options.strict) return issues;

  // Check struct name is PascalCase
  if (struct.type && !isPascalCase(struct.type)) {
    issues.push({
      severity: 'info',
      rule: 'naming-convention',
      message: `Struct name '${struct.type}' should be PascalCase`,
      struct: struct.type,
    });
  }

  // Check field names are PascalCase (FFXIVClientStructs convention)
  if (struct.fields) {
    for (const field of struct.fields) {
      if (field.name && !isPascalCase(field.name) && !isUpperSnakeCase(field.name)) {
        issues.push({
          severity: 'info',
          rule: 'naming-convention',
          message: `Field name '${field.name}' should be PascalCase`,
          struct: struct.type,
          field: field.name,
        });
      }
    }
  }

  // Check vfunc names
  if (struct.vfuncs) {
    for (const vfunc of struct.vfuncs) {
      if (vfunc.name && !isPascalCase(vfunc.name)) {
        issues.push({
          severity: 'info',
          rule: 'naming-convention',
          message: `VFunc name '${vfunc.name}' should be PascalCase`,
          struct: struct.type,
        });
      }
    }
  }

  return issues;
}

// ============================================================================
// Enum Validation Rules
// ============================================================================

/**
 * Rule: Enum values should be unique (unless aliased)
 */
export function validateEnumValues(
  enumDef: YamlEnum,
  context: ValidationContext
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!enumDef.values) return issues;

  const seenValues = new Map<number, string>();

  for (const [name, value] of Object.entries(enumDef.values)) {
    const numValue = typeof value === 'number' ? value : parseInt(value as string, 10);

    if (seenValues.has(numValue)) {
      // Duplicate enum values are often intentional aliases
      issues.push({
        severity: 'info',
        rule: 'enum-duplicate-value',
        message: `Enum value '${name}' = ${numValue} duplicates '${seenValues.get(numValue)}'`,
        struct: enumDef.type,
      });
    } else {
      seenValues.set(numValue, name);
    }
  }

  return issues;
}

/**
 * Rule: Enum should have a type name
 */
export function validateEnumName(
  enumDef: YamlEnum,
  context: ValidationContext
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (!enumDef.type) {
    issues.push({
      severity: 'error',
      rule: 'enum-name',
      message: 'Enum is missing type/name',
      struct: '<unnamed enum>',
    });
  }

  return issues;
}

// ============================================================================
// Validation Engine
// ============================================================================

const STRUCT_VALIDATORS: ValidatorFn[] = [
  validateStructName,
  validateStructSize,
  validateFieldOffsetOrder,
  validateFieldBounds,
  validateStructAlignment,
  validatePointerSizes,
  validateTypeReferences,
  validateVtableAddresses,
  validateFunctionAddresses,
  validateDuplicateOffsets,
  validateInheritanceChain,
  validateVTableConsistency,
  validatePointerAlignment,
  validateSizeFieldMismatch,
  validateNamingConvention,
];

/**
 * Run all struct validators
 */
export function validateStruct(
  struct: YamlStruct,
  context: ValidationContext
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  for (const validator of STRUCT_VALIDATORS) {
    const validatorIssues = validator(struct, context);
    for (const issue of validatorIssues) {
      // Skip ignored rules
      if (context.options.ignoreRules?.includes(issue.rule)) {
        continue;
      }
      issues.push(issue);
    }
  }

  return issues;
}

/**
 * Run all enum validators
 */
export function validateEnum(
  enumDef: YamlEnum,
  context: ValidationContext
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  const enumValidators = [validateEnumName, validateEnumValues];

  for (const validator of enumValidators) {
    const validatorIssues = validator(enumDef, context);
    for (const issue of validatorIssues) {
      if (context.options.ignoreRules?.includes(issue.rule)) {
        continue;
      }
      issues.push(issue);
    }
  }

  return issues;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Estimate field size in bytes from type and field metadata.
 * In FFXIVClientStructs YAML format, field.size typically represents array element count,
 * not byte size. So we need to multiply by element size.
 */
function estimateFieldSize(
  field: YamlField,
  context: ValidationContext
): number {
  const type = field.type;
  let elementSize = 0;

  // Check known type sizes
  if (TYPE_SIZES[type] !== undefined) {
    elementSize = TYPE_SIZES[type];
  } else if (isPointerType(type)) {
    // Pointers are always 8 bytes on x64
    elementSize = 8;
  } else {
    // Try to extract from template/array types
    const fixedArrayMatch = type.match(/^FixedArray<(.+),\s*(\d+)>$/);
    if (fixedArrayMatch) {
      const innerType = fixedArrayMatch[1];
      const count = parseInt(fixedArrayMatch[2], 10);
      const innerSize = TYPE_SIZES[innerType] ?? 0;
      if (innerSize > 0) return innerSize * count;
    }

    const arrayMatch = type.match(/^(.+)\[(\d+)\]$/);
    if (arrayMatch) {
      const innerType = arrayMatch[1];
      const count = parseInt(arrayMatch[2], 10);
      const innerSize = TYPE_SIZES[innerType] ?? 0;
      if (innerSize > 0) return innerSize * count;
    }
  }

  // If field.size is specified, treat it as array count
  if (field.size && field.size > 1 && elementSize > 0) {
    return field.size * elementSize;
  }

  // If we have a known element size but no array count, return element size
  if (elementSize > 0) {
    return elementSize;
  }

  // Unknown size
  return 0;
}

/**
 * Estimate field size for size-field-mismatch validation.
 * Similar to estimateFieldSize but used specifically for validation.
 */
function estimateFieldSizeForValidation(
  field: YamlField,
  context: ValidationContext
): number {
  const type = field.type;
  let elementSize = 0;

  // Check known type sizes
  if (TYPE_SIZES[type] !== undefined) {
    elementSize = TYPE_SIZES[type];
  } else if (isPointerType(type)) {
    // Pointers are always 8 bytes on x64
    elementSize = 8;
  } else {
    // Try to extract from template/array types
    const fixedArrayMatch = type.match(/^FixedArray<(.+),\s*(\d+)>$/);
    if (fixedArrayMatch) {
      const innerType = fixedArrayMatch[1];
      const count = parseInt(fixedArrayMatch[2], 10);
      const innerSize = TYPE_SIZES[innerType] ?? 0;
      if (innerSize > 0) return innerSize * count;
    }

    const arrayMatch = type.match(/^(.+)\[(\d+)\]$/);
    if (arrayMatch) {
      const innerType = arrayMatch[1];
      const count = parseInt(arrayMatch[2], 10);
      const innerSize = TYPE_SIZES[innerType] ?? 0;
      if (innerSize > 0) return innerSize * count;
    }
  }

  // If field.size is specified, treat it as array count
  if (field.size && field.size > 1 && elementSize > 0) {
    return field.size * elementSize;
  }

  // If we have a known element size but no array count, return element size
  if (elementSize > 0) {
    return elementSize;
  }

  // Unknown size
  return 0;
}

/**
 * Check if a string is PascalCase (starts with uppercase, no underscores except for allowed prefixes)
 */
function isPascalCase(name: string): boolean {
  // Allow names that start with underscore (private/internal fields)
  if (name.startsWith('_')) {
    name = name.slice(1);
  }

  // Empty or single char is ok
  if (name.length <= 1) return true;

  // Should start with uppercase letter
  if (!/^[A-Z]/.test(name)) return false;

  // Should not have consecutive underscores or start/end with underscore
  if (/__/.test(name) || name.endsWith('_')) return false;

  // Common patterns that are acceptable
  // Allow single underscores as word separators (some FFXIVClientStructs use this)
  // Allow all caps for acronyms in the name
  return true;
}

/**
 * Check if a string is UPPER_SNAKE_CASE (constants)
 */
function isUpperSnakeCase(name: string): boolean {
  return /^[A-Z][A-Z0-9_]*$/.test(name);
}
