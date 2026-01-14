import { describe, it, expect } from 'vitest';
import {
  diffStructs,
  diffEnums,
  analyzePatterns,
  diff,
  type StructDiff,
} from '../diff-engine.js';
import type { YamlStruct, YamlEnum } from '../types.js';

describe('diffStructs', () => {
  it('should detect added structs', () => {
    const oldStructs: YamlStruct[] = [{ type: 'StructA' }];
    const newStructs: YamlStruct[] = [{ type: 'StructA' }, { type: 'StructB' }];

    const diffs = diffStructs(oldStructs, newStructs);

    expect(diffs).toHaveLength(1);
    expect(diffs[0].type).toBe('added');
    expect(diffs[0].structName).toBe('StructB');
  });

  it('should detect removed structs', () => {
    const oldStructs: YamlStruct[] = [{ type: 'StructA' }, { type: 'StructB' }];
    const newStructs: YamlStruct[] = [{ type: 'StructA' }];

    const diffs = diffStructs(oldStructs, newStructs);

    expect(diffs).toHaveLength(1);
    expect(diffs[0].type).toBe('removed');
    expect(diffs[0].structName).toBe('StructB');
  });

  it('should detect modified structs with size change', () => {
    const oldStructs: YamlStruct[] = [{ type: 'StructA', size: 0x100 }];
    const newStructs: YamlStruct[] = [{ type: 'StructA', size: 0x110 }];

    const diffs = diffStructs(oldStructs, newStructs);

    expect(diffs).toHaveLength(1);
    expect(diffs[0].type).toBe('modified');
    expect(diffs[0].structName).toBe('StructA');
    expect(diffs[0].oldSize).toBe(0x100);
    expect(diffs[0].newSize).toBe(0x110);
  });

  it('should detect field offset changes', () => {
    const oldStructs: YamlStruct[] = [{
      type: 'StructA',
      fields: [{ type: 'int', name: 'value', offset: 0x10 }],
    }];
    const newStructs: YamlStruct[] = [{
      type: 'StructA',
      fields: [{ type: 'int', name: 'value', offset: 0x18 }],
    }];

    const diffs = diffStructs(oldStructs, newStructs);

    expect(diffs).toHaveLength(1);
    expect(diffs[0].type).toBe('modified');
    expect(diffs[0].fieldChanges).toHaveLength(1);
    expect(diffs[0].fieldChanges[0].type).toBe('modified');
    expect(diffs[0].fieldChanges[0].fieldName).toBe('value');
    expect(diffs[0].fieldChanges[0].oldOffset).toBe(0x10);
    expect(diffs[0].fieldChanges[0].newOffset).toBe(0x18);
  });

  it('should detect added fields', () => {
    const oldStructs: YamlStruct[] = [{
      type: 'StructA',
      fields: [{ type: 'int', name: 'a', offset: 0 }],
    }];
    const newStructs: YamlStruct[] = [{
      type: 'StructA',
      fields: [
        { type: 'int', name: 'a', offset: 0 },
        { type: 'int', name: 'b', offset: 4 },
      ],
    }];

    const diffs = diffStructs(oldStructs, newStructs);

    expect(diffs).toHaveLength(1);
    expect(diffs[0].fieldChanges).toHaveLength(1);
    expect(diffs[0].fieldChanges[0].type).toBe('added');
    expect(diffs[0].fieldChanges[0].fieldName).toBe('b');
  });

  it('should detect removed fields', () => {
    const oldStructs: YamlStruct[] = [{
      type: 'StructA',
      fields: [
        { type: 'int', name: 'a', offset: 0 },
        { type: 'int', name: 'b', offset: 4 },
      ],
    }];
    const newStructs: YamlStruct[] = [{
      type: 'StructA',
      fields: [{ type: 'int', name: 'a', offset: 0 }],
    }];

    const diffs = diffStructs(oldStructs, newStructs);

    expect(diffs).toHaveLength(1);
    expect(diffs[0].fieldChanges).toHaveLength(1);
    expect(diffs[0].fieldChanges[0].type).toBe('removed');
    expect(diffs[0].fieldChanges[0].fieldName).toBe('b');
  });

  it('should return empty array when structs are identical', () => {
    const struct: YamlStruct = {
      type: 'StructA',
      size: 0x10,
      fields: [{ type: 'int', name: 'a', offset: 0 }],
    };
    const oldStructs: YamlStruct[] = [struct];
    const newStructs: YamlStruct[] = [struct];

    const diffs = diffStructs(oldStructs, newStructs);

    expect(diffs).toHaveLength(0);
  });

  it('should detect vfunc slot changes', () => {
    const oldStructs: YamlStruct[] = [{
      type: 'StructA',
      vfuncs: [{ name: 'Update', id: 5 }],
    }];
    const newStructs: YamlStruct[] = [{
      type: 'StructA',
      vfuncs: [{ name: 'Update', id: 7 }],
    }];

    const diffs = diffStructs(oldStructs, newStructs);

    expect(diffs).toHaveLength(1);
    expect(diffs[0].vfuncChanges).toHaveLength(1);
    expect(diffs[0].vfuncChanges[0].type).toBe('modified');
    expect(diffs[0].vfuncChanges[0].oldId).toBe(5);
    expect(diffs[0].vfuncChanges[0].newId).toBe(7);
  });
});

describe('diffEnums', () => {
  it('should detect added enums', () => {
    const oldEnums: YamlEnum[] = [{ type: 'EnumA' }];
    const newEnums: YamlEnum[] = [{ type: 'EnumA' }, { type: 'EnumB' }];

    const diffs = diffEnums(oldEnums, newEnums);

    expect(diffs).toHaveLength(1);
    expect(diffs[0].type).toBe('added');
    expect(diffs[0].enumName).toBe('EnumB');
  });

  it('should detect removed enums', () => {
    const oldEnums: YamlEnum[] = [{ type: 'EnumA' }, { type: 'EnumB' }];
    const newEnums: YamlEnum[] = [{ type: 'EnumA' }];

    const diffs = diffEnums(oldEnums, newEnums);

    expect(diffs).toHaveLength(1);
    expect(diffs[0].type).toBe('removed');
    expect(diffs[0].enumName).toBe('EnumB');
  });

  it('should detect modified enum values', () => {
    const oldEnums: YamlEnum[] = [{
      type: 'EnumA',
      values: { A: 0, B: 1 },
    }];
    const newEnums: YamlEnum[] = [{
      type: 'EnumA',
      values: { A: 0, B: 2 },
    }];

    const diffs = diffEnums(oldEnums, newEnums);

    expect(diffs).toHaveLength(1);
    expect(diffs[0].type).toBe('modified');
    expect(diffs[0].valueChanges).toHaveLength(1);
    expect(diffs[0].valueChanges[0].type).toBe('modified');
    expect(diffs[0].valueChanges[0].name).toBe('B');
    expect(diffs[0].valueChanges[0].oldValue).toBe(1);
    expect(diffs[0].valueChanges[0].newValue).toBe(2);
  });

  it('should detect added enum values', () => {
    const oldEnums: YamlEnum[] = [{
      type: 'EnumA',
      values: { A: 0 },
    }];
    const newEnums: YamlEnum[] = [{
      type: 'EnumA',
      values: { A: 0, B: 1 },
    }];

    const diffs = diffEnums(oldEnums, newEnums);

    expect(diffs).toHaveLength(1);
    expect(diffs[0].valueChanges).toHaveLength(1);
    expect(diffs[0].valueChanges[0].type).toBe('added');
    expect(diffs[0].valueChanges[0].name).toBe('B');
  });
});

describe('analyzePatterns', () => {
  it('should detect bulk offset shift pattern', () => {
    // Simulate multiple fields all shifted by +0x8
    const structDiffs: StructDiff[] = [{
      type: 'modified',
      structName: 'StructA',
      oldSize: 0x100,
      newSize: 0x108,
      fieldChanges: [
        { type: 'modified', fieldName: 'a', fieldType: 'int', oldOffset: 0x10, newOffset: 0x18 },
        { type: 'modified', fieldName: 'b', fieldType: 'int', oldOffset: 0x20, newOffset: 0x28 },
        { type: 'modified', fieldName: 'c', fieldType: 'int', oldOffset: 0x30, newOffset: 0x38 },
        { type: 'modified', fieldName: 'd', fieldType: 'int', oldOffset: 0x40, newOffset: 0x48 },
      ],
      funcChanges: [],
      vfuncChanges: [],
    }];

    const patterns = analyzePatterns(structDiffs);

    expect(patterns.offsetShifts).toHaveLength(1);
    expect(patterns.offsetShifts[0].delta).toBe(0x8);
    expect(patterns.offsetShifts[0].matchCount).toBe(4);
    expect(patterns.offsetShifts[0].confidence).toBeGreaterThan(0);
    expect(patterns.summary).toContain('+0x8');
  });

  it('should detect vtable slot shift pattern', () => {
    const structDiffs: StructDiff[] = [{
      type: 'modified',
      structName: 'StructA',
      fieldChanges: [],
      funcChanges: [],
      vfuncChanges: [
        { type: 'modified', funcName: 'FuncA', oldId: 0, newId: 2 },
        { type: 'modified', funcName: 'FuncB', oldId: 1, newId: 3 },
        { type: 'modified', funcName: 'FuncC', oldId: 2, newId: 4 },
      ],
    }];

    const patterns = analyzePatterns(structDiffs);

    expect(patterns.vtableShifts).toHaveLength(1);
    expect(patterns.vtableShifts[0].delta).toBe(2);
    expect(patterns.vtableShifts[0].matchCount).toBe(3);
  });

  it('should return no patterns for inconsistent changes', () => {
    const structDiffs: StructDiff[] = [{
      type: 'modified',
      structName: 'StructA',
      fieldChanges: [
        { type: 'modified', fieldName: 'a', fieldType: 'int', oldOffset: 0x10, newOffset: 0x18 },
        { type: 'modified', fieldName: 'b', fieldType: 'int', oldOffset: 0x20, newOffset: 0x24 },
      ],
      funcChanges: [],
      vfuncChanges: [],
    }];

    const patterns = analyzePatterns(structDiffs);

    // Each delta appears only once, so no patterns detected
    expect(patterns.offsetShifts).toHaveLength(0);
    expect(patterns.summary).toBe('No consistent patterns detected');
  });
});

describe('diff (full integration)', () => {
  it('should produce complete diff result with stats', () => {
    const oldStructs: YamlStruct[] = [
      { type: 'StructA', size: 0x100 },
      { type: 'StructB', size: 0x50 },
    ];
    const newStructs: YamlStruct[] = [
      { type: 'StructA', size: 0x110 },
      { type: 'StructC', size: 0x80 },
    ];
    const oldEnums: YamlEnum[] = [{ type: 'EnumA' }];
    const newEnums: YamlEnum[] = [{ type: 'EnumA' }, { type: 'EnumB' }];

    const result = diff(oldStructs, newStructs, oldEnums, newEnums);

    expect(result.stats.structsAdded).toBe(1);    // StructC
    expect(result.stats.structsRemoved).toBe(1);  // StructB
    expect(result.stats.structsModified).toBe(1); // StructA size changed
    expect(result.stats.enumsAdded).toBe(1);      // EnumB
    expect(result.stats.enumsRemoved).toBe(0);
    expect(result.stats.enumsModified).toBe(0);
  });

  it('should handle empty inputs gracefully', () => {
    const result = diff([], [], [], []);

    expect(result.structs).toHaveLength(0);
    expect(result.enums).toHaveLength(0);
    expect(result.stats.structsAdded).toBe(0);
    expect(result.stats.structsRemoved).toBe(0);
    expect(result.stats.structsModified).toBe(0);
  });
});
