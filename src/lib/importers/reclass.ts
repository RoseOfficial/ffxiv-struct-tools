/**
 * ReClass.NET XML importer
 * Parses ReClass.NET XML files and converts them to YAML format
 */

import type { YamlStruct, YamlField, YamlEnum, YamlData } from '../types.js';
import { toHex } from '../types.js';

// ============================================================================
// Type Mappings
// ============================================================================

/** Map ReClass node types to YAML types */
const RECLASS_TO_YAML_TYPES: Record<string, string> = {
  'Bool': 'bool',
  'Boolean': 'bool',
  'Int8': 'sbyte',
  'UInt8': 'byte',
  'Int16': 'short',
  'UInt16': 'ushort',
  'Int32': 'int',
  'UInt32': 'uint',
  'Int64': 'long',
  'UInt64': 'ulong',
  'Float': 'float',
  'Double': 'double',
  'Pointer': 'void*',
  'Utf8Text': 'Utf8String',
  'Utf16Text': 'wchar*',
  'Utf32Text': 'uint*',
  'Hex8': 'byte',
  'Hex16': 'ushort',
  'Hex32': 'uint',
  'Hex64': 'ulong',
  'Vector2': 'Vector2',
  'Vector3': 'Vector3',
  'Vector4': 'Vector4',
  'Matrix3x3': 'float[9]',
  'Matrix3x4': 'float[12]',
  'Matrix4x4': 'Matrix4x4',
  'VTable': 'void*',      // VTable pointer at offset 0
  'FunctionPtr': 'void*',
  'NInt': 'long',         // Native int (pointer-sized)
  'NUInt': 'ulong',       // Native uint
  'BitField': 'uint',     // Bit fields are typically backed by uint
};

/** Size map for types that don't have explicit size */
const RECLASS_TYPE_SIZES: Record<string, number> = {
  'Bool': 1,
  'Boolean': 1,
  'Int8': 1,
  'UInt8': 1,
  'Int16': 2,
  'UInt16': 2,
  'Int32': 4,
  'UInt32': 4,
  'Int64': 8,
  'UInt64': 8,
  'Float': 4,
  'Double': 8,
  'Pointer': 8,
  'Hex8': 1,
  'Hex16': 2,
  'Hex32': 4,
  'Hex64': 8,
  'Vector2': 8,
  'Vector3': 12,
  'Vector4': 16,
  'Matrix3x3': 36,
  'Matrix3x4': 48,
  'Matrix4x4': 64,
  'VTable': 8,
  'FunctionPtr': 8,
  'NInt': 8,
  'NUInt': 8,
};

// ============================================================================
// Import Types
// ============================================================================

export interface ImportOptions {
  /** Prefix to add to struct names */
  prefix?: string;
  /** Whether to include comments from ReClass */
  includeComments?: boolean;
  /** Existing YAML data to merge with */
  mergeWith?: YamlData;
}

export interface ImportResult {
  /** Parsed YAML data */
  data: YamlData;
  /** Number of structs imported */
  structCount: number;
  /** Number of enums imported */
  enumCount: number;
  /** Any warnings during import */
  warnings: string[];
}

// ============================================================================
// XML Parsing Helpers
// ============================================================================

interface XmlElement {
  tagName: string;
  attributes: Record<string, string>;
  children: XmlElement[];
  textContent: string;
}

/**
 * Simple XML parser that handles the ReClass.NET format
 * Note: This is a basic parser for the specific ReClass format, not a full XML parser
 */
function parseXml(xml: string): XmlElement | null {
  // Remove XML declaration and normalize whitespace
  xml = xml.replace(/<\?xml[^?]*\?>/gi, '').trim();

  const parseElement = (start: number): { element: XmlElement | null; end: number } => {
    // Skip whitespace
    while (start < xml.length && /\s/.test(xml[start])) start++;

    if (start >= xml.length || xml[start] !== '<') {
      return { element: null, end: start };
    }

    // Check for comment
    if (xml.substring(start, start + 4) === '<!--') {
      const commentEnd = xml.indexOf('-->', start);
      if (commentEnd === -1) return { element: null, end: xml.length };
      return parseElement(commentEnd + 3);
    }

    // Parse opening tag
    const tagMatch = xml.substring(start).match(/^<([a-zA-Z_][\w.-]*)/);
    if (!tagMatch) return { element: null, end: start };

    const tagName = tagMatch[1];
    let pos = start + tagMatch[0].length;

    // Parse attributes
    const attributes: Record<string, string> = {};
    const attrRegex = /^\s+([a-zA-Z_][\w.-]*)="([^"]*)"/;

    while (pos < xml.length) {
      const attrMatch = xml.substring(pos).match(attrRegex);
      if (attrMatch) {
        attributes[attrMatch[1]] = decodeXmlEntities(attrMatch[2]);
        pos += attrMatch[0].length;
      } else {
        break;
      }
    }

    // Skip whitespace
    while (pos < xml.length && /\s/.test(xml[pos])) pos++;

    // Self-closing tag?
    if (xml.substring(pos, pos + 2) === '/>') {
      return {
        element: { tagName, attributes, children: [], textContent: '' },
        end: pos + 2,
      };
    }

    // Opening tag close
    if (xml[pos] !== '>') return { element: null, end: pos };
    pos++;

    // Parse children
    const children: XmlElement[] = [];
    let textContent = '';

    while (pos < xml.length) {
      // Skip whitespace
      while (pos < xml.length && /\s/.test(xml[pos])) pos++;

      // Closing tag?
      if (xml.substring(pos, pos + 2 + tagName.length + 1) === `</${tagName}>`) {
        pos += 2 + tagName.length + 1;
        break;
      }

      // Check for CDATA
      if (xml.substring(pos, pos + 9) === '<![CDATA[') {
        const cdataEnd = xml.indexOf(']]>', pos);
        if (cdataEnd === -1) break;
        textContent += xml.substring(pos + 9, cdataEnd);
        pos = cdataEnd + 3;
        continue;
      }

      // Child element?
      if (xml[pos] === '<' && xml[pos + 1] !== '/') {
        const result = parseElement(pos);
        if (result.element) {
          children.push(result.element);
        }
        pos = result.end;
      } else if (xml[pos] === '<') {
        break; // Unexpected closing tag
      } else {
        // Text content
        const textEnd = xml.indexOf('<', pos);
        if (textEnd === -1) break;
        textContent += xml.substring(pos, textEnd).trim();
        pos = textEnd;
      }
    }

    return {
      element: { tagName, attributes, children, textContent },
      end: pos,
    };
  };

  const result = parseElement(0);
  return result.element;
}

function decodeXmlEntities(str: string): string {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function findChild(element: XmlElement, tagName: string): XmlElement | undefined {
  return element.children.find(c => c.tagName === tagName);
}

function findChildren(element: XmlElement, tagName: string): XmlElement[] {
  return element.children.filter(c => c.tagName === tagName);
}

// ============================================================================
// Import Logic
// ============================================================================

/**
 * Import a ReClass.NET XML file and convert to YAML data
 */
export function importReclass(
  xmlContent: string,
  options: ImportOptions = {}
): ImportResult {
  const warnings: string[] = [];
  const structs: YamlStruct[] = [];
  const enums: YamlEnum[] = [];

  // Parse XML
  const root = parseXml(xmlContent);
  if (!root || root.tagName !== 'ReClass.NET') {
    // Try alternate root name
    if (!root || !root.tagName.includes('ReClass')) {
      throw new Error('Invalid ReClass.NET XML format: root element must be ReClass.NET');
    }
  }

  // Parse enums
  const enumsElement = findChild(root, 'Enums');
  if (enumsElement) {
    for (const enumEl of findChildren(enumsElement, 'Enum')) {
      const enumDef = parseEnum(enumEl, options, warnings);
      if (enumDef) {
        enums.push(enumDef);
      }
    }
  }

  // Parse classes (structs)
  const classesElement = findChild(root, 'Classes');
  if (classesElement) {
    for (const classEl of findChildren(classesElement, 'Class')) {
      const structDef = parseClass(classEl, options, warnings);
      if (structDef) {
        structs.push(structDef);
      }
    }
  }

  // Merge with existing data if provided
  let finalData: YamlData = { structs, enums };
  if (options.mergeWith) {
    finalData = mergeYamlData(options.mergeWith, finalData, warnings);
  }

  return {
    data: finalData,
    structCount: structs.length,
    enumCount: enums.length,
    warnings,
  };
}

function parseEnum(
  element: XmlElement,
  options: ImportOptions,
  warnings: string[]
): YamlEnum | null {
  const name = element.attributes['Name'];
  if (!name) {
    warnings.push('Skipping enum without Name attribute');
    return null;
  }

  const values: Record<string, number> = {};
  for (const item of findChildren(element, 'Item')) {
    const itemName = item.attributes['Name'];
    const itemValue = item.attributes['Value'];
    if (itemName && itemValue !== undefined) {
      values[itemName] = parseInt(itemValue, 10);
    }
  }

  const enumType = options.prefix ? `${options.prefix}${name}` : name;

  return {
    type: enumType,
    values,
  };
}

function parseClass(
  element: XmlElement,
  options: ImportOptions,
  warnings: string[]
): YamlStruct | null {
  const name = element.attributes['Name'];
  if (!name) {
    warnings.push('Skipping class without Name attribute');
    return null;
  }

  const comment = element.attributes['Comment'] || '';
  const structType = options.prefix ? `${options.prefix}${name}` : name;

  // Parse fields (nodes)
  const fields: YamlField[] = [];
  let currentOffset = 0;

  for (const node of findChildren(element, 'Node')) {
    const field = parseNode(node, currentOffset, options, warnings);
    if (field) {
      fields.push(field.field);
      currentOffset = field.nextOffset;
    }
  }

  // Calculate struct size from last field
  let size = 0;
  if (fields.length > 0) {
    const lastField = fields[fields.length - 1];
    const lastOffset = typeof lastField.offset === 'number'
      ? lastField.offset
      : parseInt(lastField.offset as string, 16);
    size = lastOffset + estimateFieldSize(lastField);
  }

  const struct: YamlStruct = {
    type: structType,
    size,
    fields,
  };

  if (options.includeComments && comment) {
    struct.notes = comment;
  }

  return struct;
}

interface ParsedNode {
  field: YamlField;
  nextOffset: number;
}

function parseNode(
  node: XmlElement,
  baseOffset: number,
  options: ImportOptions,
  warnings: string[]
): ParsedNode | null {
  const name = node.attributes['Name'] || '';
  const type = node.attributes['Type'] || 'Hex8';
  const comment = node.attributes['Comment'] || '';
  const hidden = node.attributes['Hidden'] === 'true';

  // Skip padding/hidden nodes unless they're significant
  if (hidden && name.startsWith('padding')) {
    const size = parseInt(node.attributes['Size'] || '1', 10);
    return {
      field: {
        type: 'byte',
        name: name,
        offset: toHex(baseOffset),
        size: size,
      },
      nextOffset: baseOffset + size,
    };
  }

  // Get offset - use attribute if available, otherwise calculate
  let offset = baseOffset;
  if (node.attributes['Offset']) {
    offset = parseInt(node.attributes['Offset'], 16) || baseOffset;
  }

  // Parse based on type
  let yamlType = RECLASS_TO_YAML_TYPES[type] || 'byte';
  let size = parseInt(node.attributes['Size'] || '0', 10);

  // Handle special types
  switch (type) {
    case 'Array': {
      const count = parseInt(node.attributes['Count'] || '1', 10);
      const innerNode = findChild(node, 'Inner');
      if (innerNode) {
        const innerType = innerNode.attributes['Type'] || 'Hex8';
        const innerSize = parseInt(innerNode.attributes['Size'] || '1', 10);
        const innerYamlType = RECLASS_TO_YAML_TYPES[innerType] || 'byte';
        yamlType = `${innerYamlType}[${count}]`;
        size = innerSize * count;
      } else {
        yamlType = `byte[${count}]`;
        size = count;
      }
      break;
    }

    case 'Pointer': {
      const innerNode = findChild(node, 'Inner');
      if (innerNode) {
        const innerType = innerNode.attributes['Type'] || '';
        const reference = innerNode.attributes['Reference'] || '';
        if (innerType === 'ClassInstance' && reference) {
          yamlType = `${reference}*`;
        } else {
          yamlType = 'void*';
        }
      }
      size = 8; // Pointers are always 8 bytes on x64
      break;
    }

    case 'ClassInstance': {
      const reference = node.attributes['Reference'] || '';
      if (reference) {
        yamlType = reference;
      }
      break;
    }

    case 'VTable':
      yamlType = 'void*';
      size = 8;
      break;

    case 'FunctionPtr':
      yamlType = 'void*';
      size = 8;
      break;

    default:
      if (size === 0) {
        size = RECLASS_TYPE_SIZES[type] || 1;
      }
  }

  const field: YamlField = {
    type: yamlType,
    offset: toHex(offset),
  };

  if (name && !name.startsWith('padding') && !name.startsWith('N')) {
    field.name = name;
  }

  if (options.includeComments && comment) {
    field.notes = comment;
  }

  return {
    field,
    nextOffset: offset + size,
  };
}

function estimateFieldSize(field: YamlField): number {
  const type = field.type;

  // Check for array types
  const arrayMatch = type.match(/\[(\d+)\]$/);
  if (arrayMatch) {
    const baseType = type.replace(/\[\d+\]$/, '');
    const count = parseInt(arrayMatch[1], 10);
    return (RECLASS_TYPE_SIZES[baseType] || 1) * count;
  }

  // Pointer types
  if (type.endsWith('*')) {
    return 8;
  }

  // Known types
  const yamlTypeToReclassType: Record<string, string> = {
    'bool': 'Bool',
    'sbyte': 'Int8',
    'byte': 'UInt8',
    'short': 'Int16',
    'ushort': 'UInt16',
    'int': 'Int32',
    'uint': 'UInt32',
    'long': 'Int64',
    'ulong': 'UInt64',
    'float': 'Float',
    'double': 'Double',
    'Utf8String': 'Utf8Text',
    'Vector2': 'Vector2',
    'Vector3': 'Vector3',
    'Vector4': 'Vector4',
    'Matrix4x4': 'Matrix4x4',
  };

  const reclassType = yamlTypeToReclassType[type];
  if (reclassType && RECLASS_TYPE_SIZES[reclassType]) {
    return RECLASS_TYPE_SIZES[reclassType];
  }

  return 8; // Default to pointer size for unknown types
}

function mergeYamlData(
  existing: YamlData,
  imported: YamlData,
  warnings: string[]
): YamlData {
  const structMap = new Map<string, YamlStruct>();
  const enumMap = new Map<string, YamlEnum>();

  // Add existing
  for (const struct of existing.structs || []) {
    structMap.set(struct.type, struct);
  }
  for (const enumDef of existing.enums || []) {
    enumMap.set(enumDef.type, enumDef);
  }

  // Merge imported
  for (const struct of imported.structs || []) {
    if (structMap.has(struct.type)) {
      // Merge fields
      const existingStruct = structMap.get(struct.type)!;
      const existingFields = new Map(
        (existingStruct.fields || []).map(f => [f.offset?.toString(), f])
      );

      for (const field of struct.fields || []) {
        const key = field.offset?.toString();
        if (key && !existingFields.has(key)) {
          existingStruct.fields = existingStruct.fields || [];
          existingStruct.fields.push(field);
        }
      }

      // Update size if larger
      if (struct.size && (!existingStruct.size || struct.size > existingStruct.size)) {
        existingStruct.size = struct.size;
      }

      warnings.push(`Merged fields into existing struct '${struct.type}'`);
    } else {
      structMap.set(struct.type, struct);
    }
  }

  for (const enumDef of imported.enums || []) {
    if (enumMap.has(enumDef.type)) {
      // Merge values
      const existingEnum = enumMap.get(enumDef.type)!;
      existingEnum.values = { ...existingEnum.values, ...enumDef.values };
      warnings.push(`Merged values into existing enum '${enumDef.type}'`);
    } else {
      enumMap.set(enumDef.type, enumDef);
    }
  }

  return {
    structs: Array.from(structMap.values()),
    enums: Array.from(enumMap.values()),
  };
}

export default { importReclass };
