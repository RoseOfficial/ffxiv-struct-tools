/**
 * C/C++ Header file exporter
 * Generates .h files with struct and enum definitions
 */

import type { YamlStruct, YamlField, YamlEnum } from '../types.js';
import { parseOffset, toHex } from '../types.js';
import {
  type Exporter,
  type ExportOptions,
  type ExportResult,
  mapToCppType,
  getTypeSize,
  sanitizeIdentifier,
  parseArrayType,
} from './base.js';

export const headersExporter: Exporter = {
  format: 'headers',
  extension: '.h',
  export: exportToHeaders,
};

function exportToHeaders(
  structs: YamlStruct[],
  enums: YamlEnum[],
  options: ExportOptions = {}
): ExportResult {
  const warnings: string[] = [];
  const lines: string[] = [];
  const namespace = options.namespace || 'FFXIV';

  // Header guard
  const guardName = `${namespace.toUpperCase()}_STRUCTS_H`;
  lines.push(`#ifndef ${guardName}`);
  lines.push(`#define ${guardName}`);
  lines.push('');

  // Includes
  lines.push('#include <cstdint>');
  lines.push('#include <cstddef>');
  lines.push('');

  // Pragma pack for exact memory layout
  lines.push('#pragma pack(push, 1)');
  lines.push('');

  // Namespace
  lines.push(`namespace ${namespace} {`);
  lines.push('');

  // Forward declarations
  if (structs.length > 0) {
    lines.push('// Forward declarations');
    for (const struct of structs) {
      lines.push(`struct ${sanitizeIdentifier(struct.type)};`);
    }
    lines.push('');
  }

  // Enums
  if (enums.length > 0) {
    lines.push('// ============================================================');
    lines.push('// Enums');
    lines.push('// ============================================================');
    lines.push('');

    for (const enumDef of enums) {
      const enumLines = generateEnumDefinition(enumDef, options);
      lines.push(...enumLines);
      lines.push('');
    }
  }

  // Structs
  if (structs.length > 0) {
    lines.push('// ============================================================');
    lines.push('// Structs');
    lines.push('// ============================================================');
    lines.push('');

    for (const struct of structs) {
      const structLines = generateStructDefinition(struct, options, warnings);
      lines.push(...structLines);
      lines.push('');
    }
  }

  // Close namespace
  lines.push(`} // namespace ${namespace}`);
  lines.push('');

  // Close pragma pack
  lines.push('#pragma pack(pop)');
  lines.push('');

  // Close header guard
  lines.push(`#endif // ${guardName}`);
  lines.push('');

  return {
    content: lines.join('\n'),
    filename: options.output || 'ffxiv_structs.h',
    structCount: structs.length,
    enumCount: enums.length,
    warnings,
  };
}

function generateEnumDefinition(enumDef: YamlEnum, options: ExportOptions): string[] {
  const lines: string[] = [];
  const enumName = sanitizeIdentifier(enumDef.type);
  const underlying = mapEnumUnderlying(enumDef.underlying);

  if (options.includeComments && enumDef.name) {
    lines.push(`// ${enumDef.name}`);
  }

  lines.push(`enum class ${enumName} : ${underlying} {`);

  if (enumDef.values) {
    const entries = Object.entries(enumDef.values);
    for (let i = 0; i < entries.length; i++) {
      const [name, value] = entries[i];
      const safeName = sanitizeIdentifier(name);
      const comma = i < entries.length - 1 ? ',' : '';
      lines.push(`    ${safeName} = ${value}${comma}`);
    }
  }

  lines.push('};');

  return lines;
}

function generateStructDefinition(
  struct: YamlStruct,
  options: ExportOptions,
  warnings: string[]
): string[] {
  const lines: string[] = [];
  const structName = sanitizeIdentifier(struct.type);
  const isUnion = struct.union === true;
  const keyword = isUnion ? 'union' : 'struct';

  // Comment with notes if enabled
  if (options.includeComments && struct.notes) {
    // Split notes into multiple comment lines
    for (const noteLine of struct.notes.split('\n')) {
      lines.push(`// ${noteLine}`);
    }
  }

  // Comment with size info
  if (struct.size) {
    lines.push(`// Size: ${toHex(struct.size)}`);
  }

  lines.push(`${keyword} ${structName} {`);

  if (struct.fields && struct.fields.length > 0) {
    // Sort fields by offset
    const sortedFields = [...struct.fields].sort((a, b) => {
      return parseOffset(a.offset) - parseOffset(b.offset);
    });

    let currentOffset = 0;

    for (const field of sortedFields) {
      const fieldOffset = parseOffset(field.offset);

      // Add padding if there's a gap (not for unions)
      if (!isUnion && fieldOffset > currentOffset) {
        const gapSize = fieldOffset - currentOffset;
        lines.push(`    uint8_t _padding_${toHex(currentOffset)}[${toHex(gapSize)}];`);
      }

      // Generate field
      const fieldLine = generateFieldDefinition(field, options, warnings);
      const fieldComment = field.notes && options.includeComments
        ? ` // ${toHex(fieldOffset)} - ${field.notes}`
        : ` // ${toHex(fieldOffset)}`;
      lines.push(`    ${fieldLine}${fieldComment}`);

      // Update current offset (not for unions)
      if (!isUnion) {
        const fieldSize = getFieldSize(field);
        currentOffset = fieldOffset + fieldSize;
      }
    }

    // Add trailing padding if struct is larger
    if (!isUnion && struct.size && struct.size > currentOffset) {
      const gapSize = struct.size - currentOffset;
      lines.push(`    uint8_t _padding_${toHex(currentOffset)}[${toHex(gapSize)}];`);
    }
  }

  lines.push('};');

  // Static assert for size verification
  if (struct.size) {
    lines.push(`static_assert(sizeof(${structName}) == ${toHex(struct.size)}, "Size mismatch for ${structName}");`);
  }

  return lines;
}

function generateFieldDefinition(field: YamlField, options: ExportOptions, warnings: string[]): string {
  const fieldName = sanitizeIdentifier(field.name || `field_${toHex(parseOffset(field.offset))}`);

  // Check for array types
  const arrayInfo = parseArrayType(field.type);
  if (arrayInfo) {
    const cppType = mapToCppType(arrayInfo.baseType);
    return `${cppType} ${fieldName}[${arrayInfo.count}];`;
  }

  // Regular types
  const cppType = mapToCppType(field.type);

  // Handle C-style arrays in type (e.g., "int[10]")
  const cArrayMatch = cppType.match(/^(.+)\[(\d+)\]$/);
  if (cArrayMatch) {
    return `${cArrayMatch[1]} ${fieldName}[${cArrayMatch[2]}];`;
  }

  return `${cppType} ${fieldName};`;
}

function mapEnumUnderlying(underlying?: string): string {
  if (!underlying) return 'int32_t';

  const typeMap: Record<string, string> = {
    'byte': 'uint8_t',
    'sbyte': 'int8_t',
    'short': 'int16_t',
    'ushort': 'uint16_t',
    'int': 'int32_t',
    'uint': 'uint32_t',
    'long': 'int64_t',
    'ulong': 'uint64_t',
  };

  return typeMap[underlying.toLowerCase()] || 'int32_t';
}

function getFieldSize(field: YamlField): number {
  if (field.size) return field.size;

  const arrayInfo = parseArrayType(field.type);
  if (arrayInfo) {
    return getTypeSize(arrayInfo.baseType) * arrayInfo.count;
  }

  return getTypeSize(field.type);
}

export default headersExporter;
