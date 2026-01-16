import { describe, it, expect } from 'vitest';
import {
  analyzeComplexity,
  generateInheritanceMermaid,
  formatComplexityTable,
} from '../complexity.js';
import type { YamlStruct } from '../../types.js';

describe('analyzeComplexity', () => {
  it('should return empty stats for empty input', () => {
    const result = analyzeComplexity([]);

    expect(result.structs).toHaveLength(0);
    expect(result.stats.totalStructs).toBe(0);
  });

  it('should calculate basic complexity for single struct', () => {
    const structs: YamlStruct[] = [
      { type: 'TestStruct', size: 16, fields: [{ type: 'int', offset: 0 }] },
    ];

    const result = analyzeComplexity(structs);

    expect(result.structs).toHaveLength(1);
    expect(result.stats.totalStructs).toBe(1);
    expect(result.structs[0].inheritanceDepth).toBe(0);
  });

  it('should calculate inheritance depth', () => {
    const structs: YamlStruct[] = [
      { type: 'Base', size: 16 },
      { type: 'Child', size: 32, base: 'Base' },
      { type: 'GrandChild', size: 48, base: 'Child' },
    ];

    const result = analyzeComplexity(structs);

    const grandChild = result.structs.find(s => s.type === 'GrandChild');
    expect(grandChild?.inheritanceDepth).toBe(2);
    expect(grandChild?.inheritanceChain).toEqual(['GrandChild', 'Child', 'Base']);
  });

  it('should count virtual functions', () => {
    const structs: YamlStruct[] = [
      {
        type: 'VFuncStruct',
        size: 16,
        vfuncs: [
          { name: 'VFunc1', id: 0 },
          { name: 'VFunc2', id: 1 },
          { name: 'VFunc3', id: 2 },
        ],
      },
    ];

    const result = analyzeComplexity(structs);

    expect(result.structs[0].vfuncCount).toBe(3);
    expect(result.stats.totalVFuncs).toBe(3);
  });

  it('should calculate field coverage', () => {
    const structs: YamlStruct[] = [
      {
        type: 'PartialStruct',
        size: 32,  // 32 bytes total
        fields: [
          { type: 'long', offset: 0 },  // 8 bytes
          { type: 'long', offset: 8 },  // 8 bytes = 16 bytes total = 50%
        ],
      },
    ];

    const result = analyzeComplexity(structs);

    expect(result.structs[0].fieldCoverage).toBe(50);
  });

  it('should track references', () => {
    const structs: YamlStruct[] = [
      { type: 'Referenced', size: 16 },
      {
        type: 'Referencer',
        size: 16,
        fields: [{ type: 'Referenced*', offset: 0 }],
      },
    ];

    const result = analyzeComplexity(structs);

    const referenced = result.structs.find(s => s.type === 'Referenced');
    const referencer = result.structs.find(s => s.type === 'Referencer');

    expect(referenced?.incomingRefs).toBe(1);
    expect(referenced?.referencedBy).toContain('Referencer');
    expect(referencer?.outgoingRefs).toBe(1);
    expect(referencer?.references).toContain('Referenced');
  });

  it('should build inheritance trees', () => {
    const structs: YamlStruct[] = [
      { type: 'Root', size: 16 },
      { type: 'Child1', size: 32, base: 'Root' },
      { type: 'Child2', size: 32, base: 'Root' },
      { type: 'GrandChild', size: 48, base: 'Child1' },
    ];

    const result = analyzeComplexity(structs);

    expect(result.inheritanceTrees.length).toBeGreaterThan(0);
    const rootTree = result.inheritanceTrees.find(t => t.root === 'Root');
    expect(rootTree).toBeDefined();
    expect(rootTree?.maxDepth).toBe(2);
    expect(rootTree?.totalStructs).toBe(4);
  });

  it('should identify orphan structs', () => {
    const structs: YamlStruct[] = [
      { type: 'UsedStruct', size: 16 },
      { type: 'OrphanStruct', size: 16 },
      {
        type: 'UserStruct',
        size: 16,
        fields: [{ type: 'UsedStruct*', offset: 0 }],
      },
    ];

    const result = analyzeComplexity(structs);

    expect(result.crossRefs.orphans).toContain('OrphanStruct');
    expect(result.crossRefs.orphans).not.toContain('UsedStruct');
  });

  it('should detect circular references', () => {
    const structs: YamlStruct[] = [
      {
        type: 'StructA',
        size: 16,
        fields: [{ type: 'StructB*', offset: 0 }],
      },
      {
        type: 'StructB',
        size: 16,
        fields: [{ type: 'StructA*', offset: 0 }],
      },
    ];

    const result = analyzeComplexity(structs);

    expect(result.crossRefs.circularRefs.length).toBeGreaterThan(0);
    const cycle = result.crossRefs.circularRefs[0];
    expect(cycle).toContain('StructA');
    expect(cycle).toContain('StructB');
  });

  it('should calculate complexity scores', () => {
    const structs: YamlStruct[] = [
      { type: 'SimpleStruct', size: 16 },
      {
        type: 'ComplexStruct',
        size: 256,
        base: 'SimpleStruct',
        vfuncs: Array.from({ length: 50 }, (_, i) => ({ name: `VFunc${i}`, id: i })),
        fields: [{ type: 'int', offset: 0 }],  // Low coverage
      },
    ];

    const result = analyzeComplexity(structs);

    const simple = result.structs.find(s => s.type === 'SimpleStruct');
    const complex = result.structs.find(s => s.type === 'ComplexStruct');

    expect(complex?.complexityScore).toBeGreaterThan(simple?.complexityScore || 0);
  });
});

describe('generateInheritanceMermaid', () => {
  it('should generate valid mermaid diagram', () => {
    const tree = {
      root: 'BaseClass',
      maxDepth: 1,
      totalStructs: 2,
      children: [
        { type: 'ChildClass', size: 32, vfuncCount: 0, children: [] },
      ],
    };

    const mermaid = generateInheritanceMermaid(tree);

    expect(mermaid).toContain('graph TD');
    expect(mermaid).toContain('BaseClass');
    expect(mermaid).toContain('ChildClass');
    expect(mermaid).toContain('-->');
  });
});

describe('formatComplexityTable', () => {
  it('should generate markdown table', () => {
    const complexities = [
      {
        type: 'TestStruct',
        inheritanceDepth: 1,
        vfuncCount: 10,
        fieldCoverage: 75,
        incomingRefs: 5,
        outgoingRefs: 2,
        complexityScore: 50,
        inheritanceChain: ['TestStruct', 'Base'],
        referencedBy: [],
        references: [],
      },
    ];

    const table = formatComplexityTable(complexities, 10);

    expect(table).toContain('| Struct |');
    expect(table).toContain('| TestStruct |');
    expect(table).toContain('| 1 |');  // depth
    expect(table).toContain('| 10 |'); // vfuncs
    expect(table).toContain('| 75% |'); // coverage
  });

  it('should limit table rows', () => {
    const complexities = Array.from({ length: 100 }, (_, i) => ({
      type: `Struct${i}`,
      inheritanceDepth: 0,
      vfuncCount: 0,
      fieldCoverage: 100,
      incomingRefs: 0,
      outgoingRefs: 0,
      complexityScore: 0,
      inheritanceChain: [`Struct${i}`],
      referencedBy: [],
      references: [],
    }));

    const table = formatComplexityTable(complexities, 5);
    // Count data rows (starts with "| Struct" followed by digit, not "| Struct |" header)
    const dataRows = table.split('\n').filter(l => /^\| Struct\d/.test(l));

    expect(dataRows.length).toBe(5);
  });
});
