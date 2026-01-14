import { describe, it, expect } from 'vitest';
import {
  validateFieldOffsetOrder,
  validateFieldBounds,
  validateStructName,
  validateStructSize,
  validateDuplicateOffsets,
  validateEnumValues,
  validateEnumName,
  validateInheritanceChain,
  validateVTableConsistency,
  validatePointerAlignment,
  validateSizeFieldMismatch,
  validateNamingConvention,
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

// ============================================================================
// New Phase 3 Validators
// ============================================================================

describe('validateInheritanceChain', () => {
  it('should pass when struct has no base', () => {
    const struct: YamlStruct = { type: 'TestStruct', size: 16 };
    const issues = validateInheritanceChain(struct, defaultContext);
    expect(issues).toHaveLength(0);
  });

  it('should pass when base struct exists', () => {
    const context = {
      allStructNames: new Set(['BaseStruct']),
      allEnumNames: new Set<string>(),
      options: {},
    };
    const struct: YamlStruct = { type: 'DerivedStruct', size: 32, base: 'BaseStruct' };
    const issues = validateInheritanceChain(struct, context);
    expect(issues).toHaveLength(0);
  });

  it('should warn when base struct does not exist', () => {
    const struct: YamlStruct = { type: 'DerivedStruct', size: 32, base: 'MissingBase' };
    const issues = validateInheritanceChain(struct, defaultContext);
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe('warning');
    expect(issues[0].rule).toBe('inheritance-chain');
    expect(issues[0].message).toContain('MissingBase');
  });

  it('should error on self-inheritance', () => {
    const struct: YamlStruct = { type: 'SelfRef', size: 16, base: 'SelfRef' };
    const issues = validateInheritanceChain(struct, defaultContext);
    expect(issues.some(i => i.severity === 'error')).toBe(true);
    expect(issues[0].rule).toBe('inheritance-chain');
  });
});

describe('validateVTableConsistency', () => {
  it('should pass when struct has no vfuncs', () => {
    const struct: YamlStruct = { type: 'TestStruct', size: 16 };
    const issues = validateVTableConsistency(struct, defaultContext);
    expect(issues).toHaveLength(0);
  });

  it('should pass for sequential vfunc IDs', () => {
    const struct: YamlStruct = {
      type: 'TestStruct',
      size: 16,
      vfuncs: [
        { name: 'Func1', id: 0 },
        { name: 'Func2', id: 1 },
        { name: 'Func3', id: 2 },
      ],
    };
    const issues = validateVTableConsistency(struct, defaultContext);
    expect(issues).toHaveLength(0);
  });

  it('should error on duplicate vfunc IDs', () => {
    const struct: YamlStruct = {
      type: 'TestStruct',
      size: 16,
      vfuncs: [
        { name: 'Func1', id: 0 },
        { name: 'Func2', id: 0 }, // duplicate
      ],
    };
    const issues = validateVTableConsistency(struct, defaultContext);
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe('error');
    expect(issues[0].rule).toBe('vtable-consistency');
  });

  it('should info on gaps in vfunc IDs', () => {
    const struct: YamlStruct = {
      type: 'TestStruct',
      size: 16,
      vfuncs: [
        { name: 'Func1', id: 0 },
        { name: 'Func3', id: 5 }, // gap of 4
      ],
    };
    const issues = validateVTableConsistency(struct, defaultContext);
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe('info');
    expect(issues[0].message).toContain('gap');
  });
});

describe('validatePointerAlignment', () => {
  const strictContext = {
    allStructNames: new Set<string>(),
    allEnumNames: new Set<string>(),
    options: { strict: true },
  };

  it('should skip check in non-strict mode', () => {
    const struct: YamlStruct = {
      type: 'TestStruct',
      size: 16,
      fields: [{ type: 'Pointer<int>', name: 'ptr', offset: 3 }], // misaligned
    };
    const issues = validatePointerAlignment(struct, defaultContext);
    expect(issues).toHaveLength(0);
  });

  it('should pass for aligned pointers in strict mode', () => {
    const struct: YamlStruct = {
      type: 'TestStruct',
      size: 16,
      fields: [
        { type: 'Pointer<int>', name: 'ptr1', offset: 0 },
        { type: 'int*', name: 'ptr2', offset: 8 },
      ],
    };
    const issues = validatePointerAlignment(struct, strictContext);
    expect(issues).toHaveLength(0);
  });

  it('should warn for misaligned pointers in strict mode', () => {
    const struct: YamlStruct = {
      type: 'TestStruct',
      size: 16,
      fields: [{ type: 'Pointer<int>', name: 'ptr', offset: 5 }],
    };
    const issues = validatePointerAlignment(struct, strictContext);
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe('warning');
    expect(issues[0].rule).toBe('pointer-alignment');
  });
});

describe('validateSizeFieldMismatch', () => {
  it('should pass when no fields exist', () => {
    const struct: YamlStruct = { type: 'TestStruct', size: 16 };
    const issues = validateSizeFieldMismatch(struct, defaultContext);
    expect(issues).toHaveLength(0);
  });

  it('should pass when struct size is larger than fields', () => {
    const struct: YamlStruct = {
      type: 'TestStruct',
      size: 32,
      fields: [
        { type: 'int', name: 'a', offset: 0 },
        { type: 'int', name: 'b', offset: 4 },
      ],
    };
    const issues = validateSizeFieldMismatch(struct, defaultContext);
    expect(issues).toHaveLength(0);
  });

  it('should error when declared size is less than calculated', () => {
    const struct: YamlStruct = {
      type: 'TestStruct',
      size: 8,
      fields: [
        { type: 'int', name: 'a', offset: 0 },
        { type: 'long', name: 'b', offset: 8 }, // 8 + 8 = 16 > 8
      ],
    };
    const issues = validateSizeFieldMismatch(struct, defaultContext);
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe('error');
    expect(issues[0].rule).toBe('size-field-mismatch');
  });

  it('should info on large gap in strict mode', () => {
    const strictContext = {
      allStructNames: new Set<string>(),
      allEnumNames: new Set<string>(),
      options: { strict: true },
    };
    const struct: YamlStruct = {
      type: 'TestStruct',
      size: 0x500, // 1280 bytes
      fields: [
        { type: 'int', name: 'a', offset: 0 },
        { type: 'int', name: 'b', offset: 4 }, // ends at 8
      ],
    };
    const issues = validateSizeFieldMismatch(struct, strictContext);
    expect(issues.some(i => i.severity === 'info' && i.message.includes('gap'))).toBe(true);
  });
});

describe('validateNamingConvention', () => {
  const strictContext = {
    allStructNames: new Set<string>(),
    allEnumNames: new Set<string>(),
    options: { strict: true },
  };

  it('should skip check in non-strict mode', () => {
    const struct: YamlStruct = { type: 'bad_name', size: 16 };
    const issues = validateNamingConvention(struct, defaultContext);
    expect(issues).toHaveLength(0);
  });

  it('should pass for PascalCase struct names', () => {
    const struct: YamlStruct = { type: 'PlayerCharacter', size: 16 };
    const issues = validateNamingConvention(struct, strictContext);
    expect(issues).toHaveLength(0);
  });

  it('should info for non-PascalCase struct names', () => {
    const struct: YamlStruct = { type: 'player_character', size: 16 };
    const issues = validateNamingConvention(struct, strictContext);
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe('info');
    expect(issues[0].rule).toBe('naming-convention');
  });

  it('should pass for PascalCase field names', () => {
    const struct: YamlStruct = {
      type: 'TestStruct',
      size: 16,
      fields: [{ type: 'int', name: 'PlayerHealth', offset: 0 }],
    };
    const issues = validateNamingConvention(struct, strictContext);
    expect(issues).toHaveLength(0);
  });

  it('should info for non-PascalCase field names', () => {
    const struct: YamlStruct = {
      type: 'TestStruct',
      size: 16,
      fields: [{ type: 'int', name: 'player_health', offset: 0 }],
    };
    const issues = validateNamingConvention(struct, strictContext);
    expect(issues.some(i => i.field === 'player_health')).toBe(true);
  });

  it('should pass for UPPER_SNAKE_CASE constants', () => {
    const struct: YamlStruct = {
      type: 'TestStruct',
      size: 16,
      fields: [{ type: 'int', name: 'MAX_HEALTH', offset: 0 }],
    };
    const issues = validateNamingConvention(struct, strictContext);
    expect(issues).toHaveLength(0);
  });

  it('should pass for underscore-prefixed private fields', () => {
    const struct: YamlStruct = {
      type: 'TestStruct',
      size: 16,
      fields: [{ type: 'int', name: '_InternalValue', offset: 0 }],
    };
    const issues = validateNamingConvention(struct, strictContext);
    expect(issues).toHaveLength(0);
  });
});
