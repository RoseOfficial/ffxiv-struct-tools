/**
 * Base types and interfaces for exporters
 */

import type { YamlStruct, YamlEnum } from '../types.js';

export type ExportFormat = 'ida' | 'reclass' | 'headers' | 'ghidra';

export interface ExportOptions {
  /** Output file or directory path */
  output?: string;
  /** Include comments/documentation */
  includeComments?: boolean;
  /** Namespace/prefix for generated types */
  namespace?: string;
  /** Target architecture (affects pointer sizes) */
  arch?: 'x64' | 'x86';
}

export interface ExportResult {
  /** Generated content (file contents) */
  content: string;
  /** Suggested filename */
  filename: string;
  /** Number of structs exported */
  structCount: number;
  /** Number of enums exported */
  enumCount: number;
  /** Any warnings during export */
  warnings: string[];
}

export interface Exporter {
  /** Format identifier */
  format: ExportFormat;
  /** File extension for output */
  extension: string;
  /** Export structs and enums to target format */
  export(
    structs: YamlStruct[],
    enums: YamlEnum[],
    options?: ExportOptions
  ): ExportResult;
}

/**
 * Map YAML types to C/C++ types
 */
export function mapToCppType(yamlType: string): string {
  // Handle pointers
  if (yamlType.endsWith('*')) {
    const baseType = yamlType.slice(0, -1).trim();
    return `${mapToCppType(baseType)}*`;
  }

  // Handle Pointer<T>
  const pointerMatch = yamlType.match(/^Pointer<(.+)>$/);
  if (pointerMatch) {
    return `${mapToCppType(pointerMatch[1])}*`;
  }

  // Handle arrays T[N]
  const arrayMatch = yamlType.match(/^(.+)\[(\d+)\]$/);
  if (arrayMatch) {
    return `${mapToCppType(arrayMatch[1])}[${arrayMatch[2]}]`;
  }

  // Handle FixedArray<T, N>
  const fixedArrayMatch = yamlType.match(/^FixedArray<(.+),\s*(\d+)>$/);
  if (fixedArrayMatch) {
    return `${mapToCppType(fixedArrayMatch[1])}[${fixedArrayMatch[2]}]`;
  }

  // Handle StdVector<T>
  const vectorMatch = yamlType.match(/^StdVector<(.+)>$/);
  if (vectorMatch) {
    return `std::vector<${mapToCppType(vectorMatch[1])}>`;
  }

  // Primitive type mappings
  const typeMap: Record<string, string> = {
    'bool': 'bool',
    'byte': 'uint8_t',
    'sbyte': 'int8_t',
    'char': 'char',
    'short': 'int16_t',
    'ushort': 'uint16_t',
    'int': 'int32_t',
    'uint': 'uint32_t',
    'long': 'int64_t',
    'ulong': 'uint64_t',
    'float': 'float',
    'double': 'double',
    '__int8': 'int8_t',
    '__int16': 'int16_t',
    '__int32': 'int32_t',
    '__int64': 'int64_t',
    'unsigned __int8': 'uint8_t',
    'unsigned __int16': 'uint16_t',
    'unsigned __int32': 'uint32_t',
    'unsigned __int64': 'uint64_t',
    'void': 'void',
    'Utf8String': 'Utf8String',
    'CString': 'char*',
  };

  return typeMap[yamlType] || yamlType;
}

/**
 * Map YAML types to IDA types
 */
export function mapToIdaType(yamlType: string): string {
  // Handle pointers
  if (yamlType.endsWith('*') || yamlType.startsWith('Pointer<')) {
    return 'void *';  // IDA uses void* for unknown pointer types
  }

  // Handle arrays - IDA uses different syntax
  const arrayMatch = yamlType.match(/^(.+)\[(\d+)\]$/);
  if (arrayMatch) {
    return mapToIdaType(arrayMatch[1]);  // Return base type, size handled separately
  }

  const fixedArrayMatch = yamlType.match(/^FixedArray<(.+),\s*(\d+)>$/);
  if (fixedArrayMatch) {
    return mapToIdaType(fixedArrayMatch[1]);
  }

  // Primitive type mappings for IDA
  const typeMap: Record<string, string> = {
    'bool': '_BOOL1',
    'byte': 'unsigned __int8',
    'sbyte': '__int8',
    'char': 'char',
    'short': '__int16',
    'ushort': 'unsigned __int16',
    'int': '__int32',
    'uint': 'unsigned __int32',
    'long': '__int64',
    'ulong': 'unsigned __int64',
    'float': 'float',
    'double': 'double',
    '__int8': '__int8',
    '__int16': '__int16',
    '__int32': '__int32',
    '__int64': '__int64',
    'unsigned __int8': 'unsigned __int8',
    'unsigned __int16': 'unsigned __int16',
    'unsigned __int32': 'unsigned __int32',
    'unsigned __int64': 'unsigned __int64',
    'void': 'void',
    'Utf8String': 'Utf8String',
    'CString': 'char *',
  };

  return typeMap[yamlType] || yamlType;
}

/**
 * Get the size of a type in bytes
 */
export function getTypeSize(yamlType: string, arch: 'x64' | 'x86' = 'x64'): number {
  const pointerSize = arch === 'x64' ? 8 : 4;

  // Handle pointers
  if (yamlType.endsWith('*') || yamlType.startsWith('Pointer<') || yamlType === 'CString') {
    return pointerSize;
  }

  // Handle arrays
  const arrayMatch = yamlType.match(/^(.+)\[(\d+)\]$/);
  if (arrayMatch) {
    return getTypeSize(arrayMatch[1], arch) * parseInt(arrayMatch[2], 10);
  }

  const fixedArrayMatch = yamlType.match(/^FixedArray<(.+),\s*(\d+)>$/);
  if (fixedArrayMatch) {
    return getTypeSize(fixedArrayMatch[1], arch) * parseInt(fixedArrayMatch[2], 10);
  }

  // Primitive sizes
  const sizeMap: Record<string, number> = {
    'bool': 1,
    'byte': 1,
    'sbyte': 1,
    'char': 1,
    'short': 2,
    'ushort': 2,
    'int': 4,
    'uint': 4,
    'long': 8,
    'ulong': 8,
    'float': 4,
    'double': 8,
    '__int8': 1,
    '__int16': 2,
    '__int32': 4,
    '__int64': 8,
    'unsigned __int8': 1,
    'unsigned __int16': 2,
    'unsigned __int32': 4,
    'unsigned __int64': 8,
    'void': 0,
    'Utf8String': 0x68,
  };

  return sizeMap[yamlType] || pointerSize; // Default to pointer size for unknown types
}

/**
 * Sanitize a name for use as an identifier
 */
export function sanitizeIdentifier(name: string): string {
  // Replace invalid characters with underscores
  let sanitized = name.replace(/[^a-zA-Z0-9_]/g, '_');

  // Ensure it doesn't start with a number
  if (/^\d/.test(sanitized)) {
    sanitized = '_' + sanitized;
  }

  return sanitized;
}

/**
 * Check if a type is an array type and extract info
 */
export function parseArrayType(yamlType: string): { baseType: string; count: number } | null {
  const arrayMatch = yamlType.match(/^(.+)\[(\d+)\]$/);
  if (arrayMatch) {
    return { baseType: arrayMatch[1], count: parseInt(arrayMatch[2], 10) };
  }

  const fixedArrayMatch = yamlType.match(/^FixedArray<(.+),\s*(\d+)>$/);
  if (fixedArrayMatch) {
    return { baseType: fixedArrayMatch[1], count: parseInt(fixedArrayMatch[2], 10) };
  }

  return null;
}
