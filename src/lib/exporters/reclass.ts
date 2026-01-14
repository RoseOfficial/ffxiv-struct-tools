/**
 * ReClass.NET XML exporter
 * Generates XML files that can be imported into ReClass.NET
 */

import type { YamlStruct, YamlField, YamlEnum } from '../types.js';
import { parseOffset, toHex } from '../types.js';
import {
  type Exporter,
  type ExportOptions,
  type ExportResult,
  getTypeSize,
  sanitizeIdentifier,
  parseArrayType,
} from './base.js';

export const reclassExporter: Exporter = {
  format: 'reclass',
  extension: '.reclass',
  export: exportToReclass,
};

function exportToReclass(
  structs: YamlStruct[],
  enums: YamlEnum[],
  options: ExportOptions = {}
): ExportResult {
  const warnings: string[] = [];
  const lines: string[] = [];

  // XML header
  lines.push('<?xml version="1.0" encoding="utf-8"?>');
  lines.push('<ReClass.NET>');
  lines.push('  <CustomData />');
  lines.push('  <TypeMappings>');
  lines.push('    <TypeMapping>');
  lines.push('      <Type>bool</Type>');
  lines.push('      <Value>Boolean</Value>');
  lines.push('    </TypeMapping>');
  lines.push('  </TypeMappings>');

  // Enums section
  lines.push('  <Enums>');
  for (const enumDef of enums) {
    lines.push(`    <Enum Name="${escapeXml(enumDef.type)}">`);
    if (enumDef.values) {
      for (const [name, value] of Object.entries(enumDef.values)) {
        const numValue = typeof value === 'string' ? parseInt(value, 10) : value;
        lines.push(`      <Item Name="${escapeXml(name)}" Value="${numValue}" />`);
      }
    }
    lines.push('    </Enum>');
  }
  lines.push('  </Enums>');

  // Classes (structs) section
  lines.push('  <Classes>');
  for (const struct of structs) {
    const structSize = struct.size || calculateStructSize(struct);
    const structComment = options.includeComments && struct.notes ? escapeXml(struct.notes) : '';
    lines.push(`    <Class Name="${escapeXml(struct.type)}" Comment="${structComment}" Address="0">`);

    // Generate nodes for each field
    if (struct.fields && struct.fields.length > 0) {
      // Sort fields by offset
      const sortedFields = [...struct.fields].sort((a, b) => {
        return parseOffset(a.offset) - parseOffset(b.offset);
      });

      let currentOffset = 0;

      for (const field of sortedFields) {
        const fieldOffset = parseOffset(field.offset);

        // Add padding if there's a gap
        if (fieldOffset > currentOffset) {
          const gapSize = fieldOffset - currentOffset;
          lines.push(`      <Node Name="padding_${toHex(currentOffset)}" Type="Hex8" Size="${gapSize}" Hidden="true" Comment="" />`);
        }

        // Add the field
        const nodeLines = generateReClassNode(field, options, warnings);
        for (const line of nodeLines) {
          lines.push(`      ${line}`);
        }

        // Update current offset
        const fieldSize = getFieldSize(field);
        currentOffset = fieldOffset + fieldSize;
      }

      // Add trailing padding if struct is larger
      if (structSize > currentOffset) {
        const gapSize = structSize - currentOffset;
        lines.push(`      <Node Name="padding_${toHex(currentOffset)}" Type="Hex8" Size="${gapSize}" Hidden="true" Comment="" />`);
      }
    }

    lines.push('    </Class>');
  }
  lines.push('  </Classes>');

  lines.push('</ReClass.NET>');

  return {
    content: lines.join('\n'),
    filename: options.output || 'ffxiv_structs.reclass',
    structCount: structs.length,
    enumCount: enums.length,
    warnings,
  };
}

function generateReClassNode(field: YamlField, options: ExportOptions, warnings: string[]): string[] {
  const lines: string[] = [];
  const fieldName = escapeXml(field.name || `field_${toHex(parseOffset(field.offset))}`);
  const comment = options.includeComments && field.notes ? escapeXml(field.notes) : '';

  // Check for array types
  const arrayInfo = parseArrayType(field.type);
  if (arrayInfo) {
    const reclassType = mapToReClassType(arrayInfo.baseType);
    const baseSize = getTypeSize(arrayInfo.baseType);
    lines.push(`<Node Name="${fieldName}" Type="Array" Count="${arrayInfo.count}" Comment="${comment}">`);
    lines.push(`  <Inner Type="${reclassType}" Size="${baseSize}" />`);
    lines.push('</Node>');
    return lines;
  }

  // Pointer types
  if (field.type.endsWith('*') || field.type.startsWith('Pointer<')) {
    lines.push(`<Node Name="${fieldName}" Type="Pointer" Comment="${comment}">`);
    lines.push('  <Inner Type="ClassInstance" Reference="" />');
    lines.push('</Node>');
    return lines;
  }

  // Regular types
  const reclassType = mapToReClassType(field.type);
  const size = field.size || getTypeSize(field.type);
  lines.push(`<Node Name="${fieldName}" Type="${reclassType}" Size="${size}" Comment="${comment}" />`);

  return lines;
}

function mapToReClassType(yamlType: string): string {
  const typeMap: Record<string, string> = {
    'bool': 'Boolean',
    'byte': 'UInt8',
    'sbyte': 'Int8',
    'char': 'Int8',
    'short': 'Int16',
    'ushort': 'UInt16',
    'int': 'Int32',
    'uint': 'UInt32',
    'long': 'Int64',
    'ulong': 'UInt64',
    'float': 'Float',
    'double': 'Double',
    '__int8': 'Int8',
    '__int16': 'Int16',
    '__int32': 'Int32',
    '__int64': 'Int64',
    'unsigned __int8': 'UInt8',
    'unsigned __int16': 'UInt16',
    'unsigned __int32': 'UInt32',
    'unsigned __int64': 'UInt64',
    'void': 'Hex8',
    'Utf8String': 'Utf8Text',
    'CString': 'Pointer',
    'Vector3': 'Vector3',
    'Vector4': 'Vector4',
  };

  return typeMap[yamlType] || 'Hex8';
}

function getFieldSize(field: YamlField): number {
  if (field.size) return field.size;

  const arrayInfo = parseArrayType(field.type);
  if (arrayInfo) {
    return getTypeSize(arrayInfo.baseType) * arrayInfo.count;
  }

  return getTypeSize(field.type);
}

function calculateStructSize(struct: YamlStruct): number {
  if (!struct.fields || struct.fields.length === 0) return 0;

  let maxEnd = 0;
  for (const field of struct.fields) {
    const offset = parseOffset(field.offset);
    const size = getFieldSize(field);
    const end = offset + size;
    if (end > maxEnd) maxEnd = end;
  }

  return maxEnd;
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export default reclassExporter;
