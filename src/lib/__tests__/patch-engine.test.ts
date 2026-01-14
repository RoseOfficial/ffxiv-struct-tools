import { describe, it, expect } from 'vitest';
import {
  applyPatchSet,
  createOffsetShiftPatch,
  createVFuncShiftPatch,
  generatePatchFromDiff,
  matchesPattern,
  serializePatchSet,
  deserializePatchSet,
  type PatchSet,
} from '../patch-engine.js';
import type { YamlStruct, YamlEnum } from '../types.js';
import type { DiffResult } from '../diff-engine.js';

describe('matchesPattern', () => {
  it('should match exact names', () => {
    expect(matchesPattern('StructA', 'StructA')).toBe(true);
    expect(matchesPattern('StructA', 'StructB')).toBe(false);
  });

  it('should match wildcard *', () => {
    expect(matchesPattern('StructA', '*')).toBe(true);
    expect(matchesPattern('Anything', '*')).toBe(true);
  });

  it('should match prefix wildcards', () => {
    expect(matchesPattern('PlayerCharacter', 'Player*')).toBe(true);
    expect(matchesPattern('EnemyCharacter', 'Player*')).toBe(false);
  });

  it('should match suffix wildcards', () => {
    expect(matchesPattern('PlayerCharacter', '*Character')).toBe(true);
    expect(matchesPattern('PlayerController', '*Character')).toBe(false);
  });

  it('should match middle wildcards', () => {
    expect(matchesPattern('GetPlayerData', 'Get*Data')).toBe(true);
    expect(matchesPattern('GetEnemyData', 'Get*Data')).toBe(true);
    expect(matchesPattern('SetPlayerData', 'Get*Data')).toBe(false);
  });
});

describe('applyPatchSet - offset shifts', () => {
  it('should shift offsets by delta', () => {
    const structs: YamlStruct[] = [{
      type: 'StructA',
      fields: [
        { type: 'int', name: 'a', offset: 0x10 },
        { type: 'int', name: 'b', offset: 0x20 },
        { type: 'int', name: 'c', offset: 0x30 },
      ],
    }];

    const patchSet: PatchSet = {
      name: 'Test',
      patches: [createOffsetShiftPatch('StructA', 0x10, 0x8)],
    };

    const { structs: result } = applyPatchSet(structs, [], patchSet);

    expect(result[0].fields![0].offset).toBe(0x18); // 0x10 + 0x8
    expect(result[0].fields![1].offset).toBe(0x28); // 0x20 + 0x8
    expect(result[0].fields![2].offset).toBe(0x38); // 0x30 + 0x8
  });

  it('should only shift offsets >= startOffset', () => {
    const structs: YamlStruct[] = [{
      type: 'StructA',
      fields: [
        { type: 'int', name: 'a', offset: 0x10 },
        { type: 'int', name: 'b', offset: 0x20 },
        { type: 'int', name: 'c', offset: 0x30 },
      ],
    }];

    const patchSet: PatchSet = {
      name: 'Test',
      patches: [createOffsetShiftPatch('StructA', 0x20, 0x8)],
    };

    const { structs: result } = applyPatchSet(structs, [], patchSet);

    expect(result[0].fields![0].offset).toBe(0x10); // unchanged
    expect(result[0].fields![1].offset).toBe(0x28); // 0x20 + 0x8
    expect(result[0].fields![2].offset).toBe(0x38); // 0x30 + 0x8
  });

  it('should apply negative delta', () => {
    const structs: YamlStruct[] = [{
      type: 'StructA',
      fields: [
        { type: 'int', name: 'a', offset: 0x20 },
      ],
    }];

    const patchSet: PatchSet = {
      name: 'Test',
      patches: [createOffsetShiftPatch('StructA', 0, -0x8)],
    };

    const { structs: result } = applyPatchSet(structs, [], patchSet);

    expect(result[0].fields![0].offset).toBe(0x18); // 0x20 - 0x8
  });

  it('should only affect matching struct patterns', () => {
    const structs: YamlStruct[] = [
      { type: 'StructA', fields: [{ type: 'int', name: 'a', offset: 0x10 }] },
      { type: 'StructB', fields: [{ type: 'int', name: 'b', offset: 0x10 }] },
    ];

    const patchSet: PatchSet = {
      name: 'Test',
      patches: [createOffsetShiftPatch('StructA', 0, 0x8)],
    };

    const { structs: result } = applyPatchSet(structs, [], patchSet);

    expect(result[0].fields![0].offset).toBe(0x18); // StructA changed
    expect(result[1].fields![0].offset).toBe(0x10); // StructB unchanged
  });

  it('should not mutate original structs', () => {
    const structs: YamlStruct[] = [{
      type: 'StructA',
      fields: [{ type: 'int', name: 'a', offset: 0x10 }],
    }];

    const patchSet: PatchSet = {
      name: 'Test',
      patches: [createOffsetShiftPatch('StructA', 0, 0x8)],
    };

    applyPatchSet(structs, [], patchSet);

    // Original should be unchanged
    expect(structs[0].fields![0].offset).toBe(0x10);
  });
});

describe('applyPatchSet - vfunc shifts', () => {
  it('should shift vfunc IDs', () => {
    const structs: YamlStruct[] = [{
      type: 'StructA',
      vfuncs: [
        { name: 'FuncA', id: 0 },
        { name: 'FuncB', id: 1 },
        { name: 'FuncC', id: 2 },
      ],
    }];

    const patchSet: PatchSet = {
      name: 'Test',
      patches: [createVFuncShiftPatch('StructA', 0, 2)],
    };

    const { structs: result } = applyPatchSet(structs, [], patchSet);

    expect(result[0].vfuncs![0].id).toBe(2);
    expect(result[0].vfuncs![1].id).toBe(3);
    expect(result[0].vfuncs![2].id).toBe(4);
  });

  it('should only shift IDs >= startId', () => {
    const structs: YamlStruct[] = [{
      type: 'StructA',
      vfuncs: [
        { name: 'FuncA', id: 0 },
        { name: 'FuncB', id: 5 },
        { name: 'FuncC', id: 10 },
      ],
    }];

    const patchSet: PatchSet = {
      name: 'Test',
      patches: [createVFuncShiftPatch('StructA', 5, 3)],
    };

    const { structs: result } = applyPatchSet(structs, [], patchSet);

    expect(result[0].vfuncs![0].id).toBe(0);  // unchanged
    expect(result[0].vfuncs![1].id).toBe(8);  // 5 + 3
    expect(result[0].vfuncs![2].id).toBe(13); // 10 + 3
  });
});

describe('applyPatchSet - result tracking', () => {
  it('should track modifications in result', () => {
    const structs: YamlStruct[] = [{
      type: 'StructA',
      fields: [{ type: 'int', name: 'a', offset: 0x10 }],
    }];

    const patchSet: PatchSet = {
      name: 'Test',
      patches: [createOffsetShiftPatch('StructA', 0, 0x8)],
    };

    const { result } = applyPatchSet(structs, [], patchSet);

    expect(result.structsProcessed).toBe(1);
    expect(result.structsModified).toBe(1);
    expect(result.details.has('StructA')).toBe(true);
  });

  it('should report zero modifications when no changes', () => {
    const structs: YamlStruct[] = [{
      type: 'StructA',
      fields: [{ type: 'int', name: 'a', offset: 0x10 }],
    }];

    const patchSet: PatchSet = {
      name: 'Test',
      patches: [createOffsetShiftPatch('StructB', 0, 0x8)], // Different struct
    };

    const { result } = applyPatchSet(structs, [], patchSet);

    expect(result.structsModified).toBe(0);
  });
});

describe('generatePatchFromDiff', () => {
  it('should generate patches from offset shift patterns', () => {
    const diffResult: DiffResult = {
      structs: [],
      enums: [],
      patterns: {
        offsetShifts: [{
          startOffset: 0x10,
          delta: 0x8,
          matchCount: 5,
          confidence: 0.5,
          affectedFields: ['StructA.field1', 'StructA.field2', 'StructA.field3'],
        }],
        vtableShifts: [],
        summary: 'Test pattern',
      },
      stats: {
        structsAdded: 0,
        structsRemoved: 0,
        structsModified: 1,
        enumsAdded: 0,
        enumsRemoved: 0,
        enumsModified: 0,
        totalFieldChanges: 3,
        totalFuncChanges: 0,
      },
    };

    const patchSet = generatePatchFromDiff(diffResult);

    expect(patchSet.patches.length).toBeGreaterThan(0);
    expect(patchSet.patches[0].type).toBe('shift_offset');
  });
});

describe('patch serialization', () => {
  it('should round-trip serialize/deserialize', () => {
    const patchSet: PatchSet = {
      name: 'Test Patch',
      description: 'A test patch',
      fromVersion: '1.0',
      toVersion: '1.1',
      patches: [
        createOffsetShiftPatch('StructA', 0x10, 0x8),
        createVFuncShiftPatch('StructB', 0, 2),
      ],
    };

    const json = serializePatchSet(patchSet);
    const restored = deserializePatchSet(json);

    expect(restored.name).toBe(patchSet.name);
    expect(restored.description).toBe(patchSet.description);
    expect(restored.patches).toHaveLength(2);
    expect(restored.patches[0].type).toBe('shift_offset');
    expect(restored.patches[1].type).toBe('shift_vfunc');
  });

  it('should throw on invalid patch format', () => {
    expect(() => deserializePatchSet('{}')).toThrow();
    expect(() => deserializePatchSet('{"name": "test"}')).toThrow();
  });
});
