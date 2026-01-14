import { describe, it, expect } from 'vitest';
import {
  idaExporter,
  reclassExporter,
  headersExporter,
  ghidraExporter,
  getExporter,
  getAvailableFormats,
  mapToCppType,
  mapToIdaType,
  getTypeSize,
  sanitizeIdentifier,
  parseArrayType,
} from '../exporters/index.js';
import type { YamlStruct, YamlEnum } from '../types.js';

// Test data
const testStructs: YamlStruct[] = [
  {
    type: 'TestStruct',
    size: 0x20,
    fields: [
      { type: 'int', name: 'value', offset: 0 },
      { type: 'float', name: 'position', offset: 4 },
      { type: 'byte', name: 'flags', offset: 8 },
      { type: 'Pointer<TestStruct>', name: 'next', offset: 0x10 },
    ],
  },
];

const testEnums: YamlEnum[] = [
  {
    type: 'TestEnum',
    underlying: 'byte',
    values: {
      None: 0,
      First: 1,
      Second: 2,
    },
  },
];

describe('base utilities', () => {
  describe('mapToCppType', () => {
    it('should map primitive types correctly', () => {
      expect(mapToCppType('int')).toBe('int32_t');
      expect(mapToCppType('uint')).toBe('uint32_t');
      expect(mapToCppType('byte')).toBe('uint8_t');
      expect(mapToCppType('float')).toBe('float');
      expect(mapToCppType('double')).toBe('double');
    });

    it('should map pointer types', () => {
      expect(mapToCppType('int*')).toBe('int32_t*');
      expect(mapToCppType('Pointer<TestStruct>')).toBe('TestStruct*');
    });

    it('should map array types', () => {
      expect(mapToCppType('int[10]')).toBe('int32_t[10]');
      expect(mapToCppType('FixedArray<byte, 16>')).toBe('uint8_t[16]');
    });

    it('should preserve unknown types', () => {
      expect(mapToCppType('CustomType')).toBe('CustomType');
    });
  });

  describe('mapToIdaType', () => {
    it('should map types for IDA', () => {
      expect(mapToIdaType('int')).toBe('__int32');
      expect(mapToIdaType('byte')).toBe('unsigned __int8');
      expect(mapToIdaType('bool')).toBe('_BOOL1');
    });

    it('should handle pointers', () => {
      expect(mapToIdaType('int*')).toBe('void *');
      expect(mapToIdaType('Pointer<Foo>')).toBe('void *');
    });
  });

  describe('getTypeSize', () => {
    it('should return correct sizes for primitives', () => {
      expect(getTypeSize('byte')).toBe(1);
      expect(getTypeSize('short')).toBe(2);
      expect(getTypeSize('int')).toBe(4);
      expect(getTypeSize('long')).toBe(8);
      expect(getTypeSize('float')).toBe(4);
      expect(getTypeSize('double')).toBe(8);
    });

    it('should return pointer size for pointers', () => {
      expect(getTypeSize('int*', 'x64')).toBe(8);
      expect(getTypeSize('int*', 'x86')).toBe(4);
      expect(getTypeSize('Pointer<Foo>')).toBe(8);
    });

    it('should calculate array sizes', () => {
      expect(getTypeSize('int[10]')).toBe(40);
      expect(getTypeSize('FixedArray<byte, 16>')).toBe(16);
    });
  });

  describe('sanitizeIdentifier', () => {
    it('should replace invalid characters', () => {
      expect(sanitizeIdentifier('my-field')).toBe('my_field');
      expect(sanitizeIdentifier('my.field')).toBe('my_field');
      expect(sanitizeIdentifier('my field')).toBe('my_field');
    });

    it('should prefix with underscore if starts with number', () => {
      expect(sanitizeIdentifier('123abc')).toBe('_123abc');
    });

    it('should preserve valid identifiers', () => {
      expect(sanitizeIdentifier('validName')).toBe('validName');
      expect(sanitizeIdentifier('_private')).toBe('_private');
    });
  });

  describe('parseArrayType', () => {
    it('should parse C-style arrays', () => {
      const result = parseArrayType('int[10]');
      expect(result).toEqual({ baseType: 'int', count: 10 });
    });

    it('should parse FixedArray templates', () => {
      const result = parseArrayType('FixedArray<byte, 16>');
      expect(result).toEqual({ baseType: 'byte', count: 16 });
    });

    it('should return null for non-array types', () => {
      expect(parseArrayType('int')).toBeNull();
      expect(parseArrayType('int*')).toBeNull();
    });
  });
});

describe('exporter registry', () => {
  it('should return all available formats', () => {
    const formats = getAvailableFormats();
    expect(formats).toContain('ida');
    expect(formats).toContain('reclass');
    expect(formats).toContain('headers');
    expect(formats).toContain('ghidra');
  });

  it('should get exporters by format', () => {
    expect(getExporter('ida')).toBe(idaExporter);
    expect(getExporter('reclass')).toBe(reclassExporter);
    expect(getExporter('headers')).toBe(headersExporter);
    expect(getExporter('ghidra')).toBe(ghidraExporter);
  });
});

describe('idaExporter', () => {
  it('should have correct format and extension', () => {
    expect(idaExporter.format).toBe('ida');
    expect(idaExporter.extension).toBe('.py');
  });

  it('should export structs and enums', () => {
    const result = idaExporter.export(testStructs, testEnums);

    expect(result.structCount).toBe(1);
    expect(result.enumCount).toBe(1);
    expect(result.content).toContain('import idc');
    expect(result.content).toContain('TestStruct');
    expect(result.content).toContain('TestEnum');
    expect(result.content).toContain('def main()');
  });

  it('should generate valid Python syntax', () => {
    const result = idaExporter.export(testStructs, testEnums);

    // Should have proper function definitions
    expect(result.content).toMatch(/^def \w+\(/m);
    // Should have main guard
    expect(result.content).toContain('if __name__ == "__main__"');
    // Should have proper class/function structure
    expect(result.content).toContain('def create_enums():');
    expect(result.content).toContain('def create_structs():');
  });
});

describe('reclassExporter', () => {
  it('should have correct format and extension', () => {
    expect(reclassExporter.format).toBe('reclass');
    expect(reclassExporter.extension).toBe('.reclass');
  });

  it('should export valid XML', () => {
    const result = reclassExporter.export(testStructs, testEnums);

    expect(result.content).toContain('<?xml version="1.0"');
    expect(result.content).toContain('<ReClass.NET>');
    expect(result.content).toContain('</ReClass.NET>');
    expect(result.content).toContain('<Class Name="TestStruct"');
    expect(result.content).toContain('<Enum Name="TestEnum">');
  });

  it('should escape XML special characters', () => {
    const structsWithSpecialChars: YamlStruct[] = [
      { type: 'Test<Struct>', size: 8 },
    ];

    const result = reclassExporter.export(structsWithSpecialChars, []);
    expect(result.content).toContain('Test&lt;Struct&gt;');
  });
});

describe('headersExporter', () => {
  it('should have correct format and extension', () => {
    expect(headersExporter.format).toBe('headers');
    expect(headersExporter.extension).toBe('.h');
  });

  it('should generate valid C++ header', () => {
    const result = headersExporter.export(testStructs, testEnums);

    expect(result.content).toContain('#ifndef');
    expect(result.content).toContain('#define');
    expect(result.content).toContain('#endif');
    expect(result.content).toContain('#pragma pack(push, 1)');
    expect(result.content).toContain('#pragma pack(pop)');
    expect(result.content).toContain('namespace FFXIV');
  });

  it('should generate struct with static_assert', () => {
    const result = headersExporter.export(testStructs, testEnums);

    expect(result.content).toContain('struct TestStruct');
    expect(result.content).toContain('static_assert(sizeof(TestStruct) == 0x20');
  });

  it('should generate enum class with underlying type', () => {
    const result = headersExporter.export(testStructs, testEnums);

    expect(result.content).toContain('enum class TestEnum : uint8_t');
    expect(result.content).toContain('None = 0');
    expect(result.content).toContain('First = 1');
  });

  it('should use custom namespace', () => {
    const result = headersExporter.export(testStructs, testEnums, { namespace: 'Custom' });

    expect(result.content).toContain('namespace Custom');
    expect(result.content).toContain('CUSTOM_STRUCTS_H');
  });
});

describe('ghidraExporter', () => {
  it('should have correct format and extension', () => {
    expect(ghidraExporter.format).toBe('ghidra');
    expect(ghidraExporter.extension).toBe('.py');
  });

  it('should generate Ghidra script', () => {
    const result = ghidraExporter.export(testStructs, testEnums);

    expect(result.content).toContain('from ghidra.program.model.data import');
    expect(result.content).toContain('FFXIVTypeCreator');
    expect(result.content).toContain('create_enums');
    expect(result.content).toContain('create_structs');
    expect(result.content).toContain('def main()');
  });

  it('should use custom category path', () => {
    const result = ghidraExporter.export(testStructs, testEnums, { namespace: '/Custom/Path' });

    expect(result.content).toContain('CategoryPath("/Custom/Path")');
  });
});

describe('empty input handling', () => {
  it('should handle empty structs and enums', () => {
    const idaResult = idaExporter.export([], []);
    const reclassResult = reclassExporter.export([], []);
    const headersResult = headersExporter.export([], []);
    const ghidraResult = ghidraExporter.export([], []);

    expect(idaResult.structCount).toBe(0);
    expect(idaResult.enumCount).toBe(0);
    expect(reclassResult.structCount).toBe(0);
    expect(headersResult.structCount).toBe(0);
    expect(ghidraResult.structCount).toBe(0);
  });
});
