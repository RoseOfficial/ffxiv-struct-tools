import { describe, it, expect } from 'vitest';
import { importReclass } from '../reclass.js';

const sampleReclassXml = `<?xml version="1.0" encoding="utf-8"?>
<ReClass.NET>
  <CustomData />
  <TypeMappings>
    <TypeMapping>
      <Type>bool</Type>
      <Value>Boolean</Value>
    </TypeMapping>
  </TypeMappings>
  <Enums>
    <Enum Name="TestEnum">
      <Item Name="Value1" Value="0" />
      <Item Name="Value2" Value="1" />
      <Item Name="Value3" Value="2" />
    </Enum>
  </Enums>
  <Classes>
    <Class Name="TestStruct" Comment="A test structure" Address="0">
      <Node Name="IntField" Type="Int32" Size="4" Comment="An integer field" />
      <Node Name="FloatField" Type="Float" Size="4" Comment="A float field" />
      <Node Name="Ptr" Type="Pointer" Comment="A pointer">
        <Inner Type="ClassInstance" Reference="OtherStruct" />
      </Node>
    </Class>
    <Class Name="ArrayStruct" Comment="" Address="0">
      <Node Name="Values" Type="Array" Count="10" Comment="">
        <Inner Type="Int32" Size="4" />
      </Node>
    </Class>
  </Classes>
</ReClass.NET>`;

describe('importReclass', () => {
  it('should parse basic ReClass XML', () => {
    const result = importReclass(sampleReclassXml);

    expect(result.structCount).toBe(2);
    expect(result.enumCount).toBe(1);
    expect(result.warnings).toHaveLength(0);
  });

  it('should parse struct definitions', () => {
    const result = importReclass(sampleReclassXml);
    const testStruct = result.data.structs?.find(s => s.type === 'TestStruct');

    expect(testStruct).toBeDefined();
    expect(testStruct?.fields).toHaveLength(3);
  });

  it('should parse enum definitions', () => {
    const result = importReclass(sampleReclassXml);
    const testEnum = result.data.enums?.find(e => e.type === 'TestEnum');

    expect(testEnum).toBeDefined();
    expect(testEnum?.values).toEqual({
      Value1: 0,
      Value2: 1,
      Value3: 2,
    });
  });

  it('should convert ReClass types to YAML types', () => {
    const result = importReclass(sampleReclassXml);
    const testStruct = result.data.structs?.find(s => s.type === 'TestStruct');
    const fields = testStruct?.fields || [];

    expect(fields[0].type).toBe('int');     // Int32 -> int
    expect(fields[1].type).toBe('float');   // Float -> float
    expect(fields[2].type).toBe('OtherStruct*');  // Pointer with reference
  });

  it('should parse array types', () => {
    const result = importReclass(sampleReclassXml);
    const arrayStruct = result.data.structs?.find(s => s.type === 'ArrayStruct');
    const fields = arrayStruct?.fields || [];

    expect(fields[0].type).toBe('int[10]');
  });

  it('should include comments when option is set', () => {
    const result = importReclass(sampleReclassXml, { includeComments: true });
    const testStruct = result.data.structs?.find(s => s.type === 'TestStruct');

    expect(testStruct?.notes).toBe('A test structure');
    expect(testStruct?.fields?.[0].notes).toBe('An integer field');
  });

  it('should apply prefix when option is set', () => {
    const result = importReclass(sampleReclassXml, { prefix: 'FF_' });

    expect(result.data.structs?.some(s => s.type === 'FF_TestStruct')).toBe(true);
    expect(result.data.enums?.some(e => e.type === 'FF_TestEnum')).toBe(true);
  });

  it('should throw on invalid XML', () => {
    expect(() => importReclass('not valid xml')).toThrow();
  });

  it('should throw on non-ReClass XML', () => {
    const invalidXml = '<?xml version="1.0"?><SomeOtherRoot></SomeOtherRoot>';
    expect(() => importReclass(invalidXml)).toThrow(/ReClass/);
  });
});

describe('importReclass merge', () => {
  const minimalXml = `<?xml version="1.0"?>
<ReClass.NET>
  <Classes>
    <Class Name="NewStruct" Address="0">
      <Node Name="NewField" Type="Int32" />
    </Class>
  </Classes>
</ReClass.NET>`;

  it('should merge with existing data', () => {
    const existing = {
      structs: [
        { type: 'ExistingStruct', size: 16, fields: [{ type: 'int', offset: 0 }] },
      ],
      enums: [],
    };

    const result = importReclass(minimalXml, { mergeWith: existing });

    expect(result.data.structs?.length).toBe(2);
    expect(result.data.structs?.some(s => s.type === 'ExistingStruct')).toBe(true);
    expect(result.data.structs?.some(s => s.type === 'NewStruct')).toBe(true);
  });
});
