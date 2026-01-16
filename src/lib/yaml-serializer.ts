/**
 * YAML serializer for struct definitions
 * Provides consistent serialization of YamlData to YAML format
 */

import yaml from 'js-yaml';
import type { YamlData, YamlStruct, YamlField, YamlEnum } from './types.js';
import { parseOffset, toHex } from './types.js';

// ============================================================================
// Serialization Options
// ============================================================================

export interface SerializeOptions {
  /** Include comments/notes in output */
  includeComments?: boolean;
  /** Sort fields by offset */
  sortFields?: boolean;
  /** Sort structs alphabetically */
  sortStructs?: boolean;
  /** Use hex format for offsets */
  hexOffsets?: boolean;
  /** Indent size */
  indent?: number;
}

const DEFAULT_OPTIONS: SerializeOptions = {
  includeComments: true,
  sortFields: true,
  sortStructs: false,
  hexOffsets: true,
  indent: 2,
};

// ============================================================================
// Serialization Functions
// ============================================================================

/**
 * Serialize YamlData to YAML string
 */
export function serializeYaml(
  data: YamlData,
  options: SerializeOptions = {}
): string {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  // Prepare data for serialization
  const preparedData = prepareForSerialization(data, opts);

  return yaml.dump(preparedData, {
    indent: opts.indent,
    lineWidth: -1, // Don't wrap lines
    quotingType: '"',
    forceQuotes: false,
    sortKeys: false,
  });
}

/**
 * Serialize a single struct to YAML string
 */
export function serializeStruct(
  struct: YamlStruct,
  options: SerializeOptions = {}
): string {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const prepared = prepareStruct(struct, opts);

  return yaml.dump(prepared, {
    indent: opts.indent,
    lineWidth: -1,
    quotingType: '"',
    forceQuotes: false,
    sortKeys: false,
  });
}

// ============================================================================
// Preparation Helpers
// ============================================================================

function prepareForSerialization(
  data: YamlData,
  options: SerializeOptions
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  // Prepare structs
  if (data.structs && data.structs.length > 0) {
    let structs = data.structs.map((s) => prepareStruct(s, options));

    if (options.sortStructs) {
      structs = structs.sort((a, b) =>
        (a.type as string).localeCompare(b.type as string)
      );
    }

    result.structs = structs;
  }

  // Prepare enums
  if (data.enums && data.enums.length > 0) {
    let enums = data.enums.map((e) => prepareEnum(e, options));

    if (options.sortStructs) {
      enums = enums.sort((a, b) =>
        (a.type as string).localeCompare(b.type as string)
      );
    }

    result.enums = enums;
  }

  return result;
}

function prepareStruct(
  struct: YamlStruct,
  options: SerializeOptions
): Record<string, unknown> {
  const result: Record<string, unknown> = {
    type: struct.type,
  };

  // Size (use hex if configured)
  if (struct.size !== undefined) {
    result.size = options.hexOffsets ? toHex(struct.size) : struct.size;
  }

  // Inheritance
  if (struct.base) {
    result.base = struct.base;
  }

  // Union
  if (struct.union) {
    result.union = struct.union;
  }

  // Category
  if (struct.category) {
    result.category = struct.category;
  }

  // Notes
  if (options.includeComments && struct.notes) {
    result.notes = struct.notes;
  }

  // Fields
  if (struct.fields && struct.fields.length > 0) {
    let fields = struct.fields.map((f) => prepareField(f, options));

    if (options.sortFields) {
      fields = fields.sort((a, b) => {
        const aOffset = typeof a.offset === 'string'
          ? parseInt(a.offset, 16)
          : (a.offset as number);
        const bOffset = typeof b.offset === 'string'
          ? parseInt(b.offset, 16)
          : (b.offset as number);
        return aOffset - bOffset;
      });
    }

    result.fields = fields;
  }

  // Virtual functions
  if (struct.vfuncs && struct.vfuncs.length > 0) {
    result.vfuncs = struct.vfuncs.map((v) => ({
      ...(v.name && { name: v.name }),
      ...(v.id !== undefined && { id: v.id }),
      ...(v.signature && { signature: v.signature }),
    }));
  }

  // Regular functions
  if (struct.funcs && struct.funcs.length > 0) {
    result.funcs = struct.funcs.map((f) => ({
      ...(f.name && { name: f.name }),
      ...(f.ea !== undefined && { ea: f.ea }),
      ...(f.signature && { signature: f.signature }),
    }));
  }

  return result;
}

function prepareField(
  field: YamlField,
  options: SerializeOptions
): Record<string, unknown> {
  const result: Record<string, unknown> = {
    type: field.type,
  };

  // Name (only if defined)
  if (field.name) {
    result.name = field.name;
  }

  // Offset (use hex if configured)
  if (field.offset !== undefined) {
    const offsetNum = parseOffset(field.offset);
    result.offset = options.hexOffsets ? toHex(offsetNum) : offsetNum;
  }

  // Size (only if explicitly set)
  if (field.size !== undefined) {
    result.size = field.size;
  }

  // Notes
  if (options.includeComments && field.notes) {
    result.notes = field.notes;
  }

  return result;
}

function prepareEnum(
  enumDef: YamlEnum,
  _options: SerializeOptions
): Record<string, unknown> {
  const result: Record<string, unknown> = {
    type: enumDef.type,
  };

  if (enumDef.name) {
    result.name = enumDef.name;
  }

  if (enumDef.underlying) {
    result.underlying = enumDef.underlying;
  }

  if (enumDef.values) {
    result.values = enumDef.values;
  }

  return result;
}

export default {
  serializeYaml,
  serializeStruct,
};
