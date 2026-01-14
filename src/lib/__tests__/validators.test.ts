import { describe, it, expect } from 'vitest';
import {
  validateFieldOffsetOrder,
  validateFieldBounds,
  validateStructName,
  validateStructSize,
  validateDuplicateOffsets,
  validateEnumValues,
  validateEnumName,
} from '../validators.js';
import type { YamlStruct, YamlEnum } from '../types.js';

const defaultContext = {
  allStructNames: new Set<string>(),
  allEnumNames: new Set<string>(),
  options: {},
};

describe('validateStructName', () => {
  it('should error if struct has no type', () => {
    const struct: YamlStruct = { type: '' };
    const issues = validateStructName(struct, defaultContext);
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe('error');
    expect(issues[0].rule).toBe('struct-name');
  });

  it('should pass if struct has a type', () => {
    const struct: YamlStruct = { type: 'TestStruct' };
    const issues = validateStructName(struct, defaultContext);
    expect(issues).toHaveLength(0);
  });
});

describe('validateStructSize', () => {
  it('should warn if struct has no size', () => {
    const struct: YamlStruct = { type: 'TestStruct' };
    const issues = validateStructSize(struct, defaultContext);
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe('warning');
    expect(issues[0].rule).toBe('struct-size');
  });

  it('should warn if struct has size 0', () => {
    const struct: YamlStruct = { type: 'TestStruct', size: 0 };
    const issues = validateStructSize(struct, defaultContext);
    expect(issues).toHaveLength(1);
  });

  it('should pass if struct has positive size', () => {
    const struct: YamlStruct = { type: 'TestStruct', size: 16 };
    const issues = validateStructSize(struct, defaultContext);
    expect(issues).toHaveLength(0);
  });
});

describe('validateFieldOffsetOrder', () => {
  it('should pass for ascending offsets', () => {
    const struct: YamlStruct = {
      type: 'TestStruct',
      fields: [
        { type: 'int', offset: 0 },
        { type: 'int', offset: 4 },
        { type: 'int', offset: 8 },
      ],
    };
    const issues = validateFieldOffsetOrder(struct, defaultContext);
    expect(issues).toHaveLength(0);
  });

  it('should warn for descending offsets', () => {
    const struct: YamlStruct = {
      type: 'TestStruct',
      fields: [
        { type: 'int', offset: 8 },
        { type: 'int', offset: 4 },
      ],
    };
    const issues = validateFieldOffsetOrder(struct, defaultContext);
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe('warning');
    expect(issues[0].rule).toBe('field-offset-order');
  });

  it('should skip check for unions', () => {
    const struct: YamlStruct = {
      type: 'TestUnion',
      union: true,
      fields: [
        { type: 'int', offset: 0 },
        { type: 'float', offset: 0 },
      ],
    };
    const issues = validateFieldOffsetOrder(struct, defaultContext);
    expect(issues).toHaveLength(0);
  });

  it('should handle hex offsets', () => {
    const struct: YamlStruct = {
      type: 'TestStruct',
      fields: [
        { type: 'int', offset: '0x0' },
        { type: 'int', offset: '0x4' },
        { type: 'int', offset: '0x8' },
      ],
    };
    const issues = validateFieldOffsetOrder(struct, defaultContext);
    expect(issues).toHaveLength(0);
  });
});

describe('validateFieldBounds', () => {
  it('should pass when field fits within struct', () => {
    const struct: YamlStruct = {
      type: 'TestStruct',
      size: 16,
      fields: [{ type: 'int', offset: 0 }],
    };
    const issues = validateFieldBounds(struct, defaultContext);
    expect(issues).toHaveLength(0);
  });

  it('should error when field exceeds struct size', () => {
    const struct: YamlStruct = {
      type: 'TestStruct',
      size: 8,
      fields: [{ type: '__int64', offset: 8 }], // offset 8 + size 8 = 16 > 8
    };
    const issues = validateFieldBounds(struct, defaultContext);
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe('error');
    expect(issues[0].rule).toBe('field-bounds');
  });
});

describe('validateDuplicateOffsets', () => {
  it('should pass for unique offsets', () => {
    const struct: YamlStruct = {
      type: 'TestStruct',
      fields: [
        { type: 'int', name: 'a', offset: 0 },
        { type: 'int', name: 'b', offset: 4 },
      ],
    };
    const issues = validateDuplicateOffsets(struct, defaultContext);
    expect(issues).toHaveLength(0);
  });

  it('should info for duplicate offsets', () => {
    const struct: YamlStruct = {
      type: 'TestStruct',
      fields: [
        { type: 'int', name: 'a', offset: 0 },
        { type: 'float', name: 'b', offset: 0 },
      ],
    };
    const issues = validateDuplicateOffsets(struct, defaultContext);
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe('info');
    expect(issues[0].rule).toBe('duplicate-offset');
  });

  it('should skip check for unions', () => {
    const struct: YamlStruct = {
      type: 'TestUnion',
      union: true,
      fields: [
        { type: 'int', name: 'a', offset: 0 },
        { type: 'float', name: 'b', offset: 0 },
      ],
    };
    const issues = validateDuplicateOffsets(struct, defaultContext);
    expect(issues).toHaveLength(0);
  });
});

describe('validateEnumName', () => {
  it('should error if enum has no type', () => {
    const enumDef: YamlEnum = { type: '' };
    const issues = validateEnumName(enumDef, defaultContext);
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe('error');
    expect(issues[0].rule).toBe('enum-name');
  });

  it('should pass if enum has a type', () => {
    const enumDef: YamlEnum = { type: 'TestEnum' };
    const issues = validateEnumName(enumDef, defaultContext);
    expect(issues).toHaveLength(0);
  });
});

describe('validateEnumValues', () => {
  it('should pass for unique values', () => {
    const enumDef: YamlEnum = {
      type: 'TestEnum',
      values: { A: 0, B: 1, C: 2 },
    };
    const issues = validateEnumValues(enumDef, defaultContext);
    expect(issues).toHaveLength(0);
  });

  it('should info for duplicate values', () => {
    const enumDef: YamlEnum = {
      type: 'TestEnum',
      values: { A: 0, B: 0 },
    };
    const issues = validateEnumValues(enumDef, defaultContext);
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe('info');
    expect(issues[0].rule).toBe('enum-duplicate-value');
  });
});
