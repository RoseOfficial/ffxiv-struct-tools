/**
 * Complexity analyzer for FFXIV struct hierarchies
 * Calculates metrics like inheritance depth, vtable size, field coverage, and cross-references
 */

import type { YamlStruct, YamlField } from '../types.js';
import { parseOffset, toHex, extractBaseType, TYPE_SIZES } from '../types.js';

// ============================================================================
// Types
// ============================================================================

export interface StructComplexity {
  /** Struct type name */
  type: string;
  /** Inheritance depth (0 = no base class) */
  inheritanceDepth: number;
  /** Number of virtual function slots */
  vfuncCount: number;
  /** Percentage of struct size covered by documented fields (0-100) */
  fieldCoverage: number;
  /** Number of other structs that reference this one */
  incomingRefs: number;
  /** Number of other structs this one references */
  outgoingRefs: number;
  /** Combined complexity score (0-100) */
  complexityScore: number;
  /** Base struct chain */
  inheritanceChain: string[];
  /** List of structs that reference this one */
  referencedBy: string[];
  /** List of structs this one references */
  references: string[];
}

export interface ComplexityReport {
  /** All analyzed structs with their complexity metrics */
  structs: StructComplexity[];
  /** Inheritance trees organized by root */
  inheritanceTrees: InheritanceTree[];
  /** Cross-reference summary */
  crossRefs: CrossRefSummary;
  /** Overall statistics */
  stats: ComplexityStats;
}

export interface InheritanceTree {
  /** Root struct (has no base) */
  root: string;
  /** Maximum depth of this tree */
  maxDepth: number;
  /** Total number of structs in this tree */
  totalStructs: number;
  /** Tree structure */
  children: TreeNode[];
}

export interface TreeNode {
  type: string;
  size?: number;
  vfuncCount: number;
  children: TreeNode[];
}

export interface CrossRefSummary {
  /** Structs sorted by incoming reference count */
  mostReferenced: Array<{ type: string; count: number }>;
  /** Structs with no incoming references */
  orphans: string[];
  /** Circular reference chains detected */
  circularRefs: string[][];
}

export interface ComplexityStats {
  /** Total structs analyzed */
  totalStructs: number;
  /** Average inheritance depth */
  avgInheritanceDepth: number;
  /** Maximum inheritance depth */
  maxInheritanceDepth: number;
  /** Average field coverage */
  avgFieldCoverage: number;
  /** Total virtual functions */
  totalVFuncs: number;
  /** Average complexity score */
  avgComplexityScore: number;
}

// ============================================================================
// Analysis Functions
// ============================================================================

/**
 * Analyze complexity of a set of structs
 */
export function analyzeComplexity(structs: YamlStruct[]): ComplexityReport {
  // Build lookup maps
  const structMap = new Map<string, YamlStruct>();
  for (const struct of structs) {
    structMap.set(struct.type, struct);
  }

  // Calculate references
  const incomingRefs = new Map<string, Set<string>>();
  const outgoingRefs = new Map<string, Set<string>>();

  for (const struct of structs) {
    outgoingRefs.set(struct.type, new Set());

    // Add inheritance as reference
    if (struct.base && structMap.has(struct.base)) {
      addRef(outgoingRefs, struct.type, struct.base);
      addRef(incomingRefs, struct.base, struct.type);
    }

    // Add field type references
    if (struct.fields) {
      for (const field of struct.fields) {
        const baseType = extractBaseType(field.type);
        if (structMap.has(baseType) && baseType !== struct.type) {
          addRef(outgoingRefs, struct.type, baseType);
          addRef(incomingRefs, baseType, struct.type);
        }
      }
    }
  }

  // Calculate complexity for each struct
  const complexities: StructComplexity[] = [];

  for (const struct of structs) {
    const inheritanceChain = getInheritanceChain(struct.type, structMap);
    const incoming = incomingRefs.get(struct.type) || new Set();
    const outgoing = outgoingRefs.get(struct.type) || new Set();

    const complexity: StructComplexity = {
      type: struct.type,
      inheritanceDepth: inheritanceChain.length - 1, // -1 because chain includes self
      vfuncCount: struct.vfuncs?.length || 0,
      fieldCoverage: calculateFieldCoverage(struct),
      incomingRefs: incoming.size,
      outgoingRefs: outgoing.size,
      complexityScore: 0, // Calculated below
      inheritanceChain,
      referencedBy: Array.from(incoming),
      references: Array.from(outgoing),
    };

    // Calculate complexity score (weighted combination)
    complexity.complexityScore = calculateComplexityScore(complexity);
    complexities.push(complexity);
  }

  // Sort by complexity score
  complexities.sort((a, b) => b.complexityScore - a.complexityScore);

  // Build inheritance trees
  const inheritanceTrees = buildInheritanceTrees(structs, structMap);

  // Build cross-reference summary
  const crossRefs = buildCrossRefSummary(complexities, structMap);

  // Calculate stats
  const stats = calculateStats(complexities);

  return {
    structs: complexities,
    inheritanceTrees,
    crossRefs,
    stats,
  };
}

function addRef(
  map: Map<string, Set<string>>,
  from: string,
  to: string
): void {
  if (!map.has(from)) {
    map.set(from, new Set());
  }
  map.get(from)!.add(to);
}

function getInheritanceChain(
  type: string,
  structMap: Map<string, YamlStruct>
): string[] {
  const chain: string[] = [];
  const visited = new Set<string>();
  let current: string | undefined = type;

  while (current && !visited.has(current)) {
    visited.add(current);
    chain.push(current);

    const struct = structMap.get(current);
    current = struct?.base;
  }

  return chain;
}

function calculateFieldCoverage(struct: YamlStruct): number {
  if (!struct.size || !struct.fields || struct.fields.length === 0) {
    return 0;
  }

  let documentedBytes = 0;

  for (const field of struct.fields) {
    const size = estimateFieldSize(field);
    if (size > 0) {
      documentedBytes += size;
    }
  }

  return Math.min(100, Math.round((documentedBytes / struct.size) * 100));
}

function estimateFieldSize(field: YamlField): number {
  const type = field.type;

  // Check TYPE_SIZES
  if (TYPE_SIZES[type] !== undefined) {
    return field.size && field.size > 1
      ? TYPE_SIZES[type] * field.size
      : TYPE_SIZES[type];
  }

  // Pointer types
  if (type.endsWith('*') || type.startsWith('Pointer<')) {
    return 8;
  }

  // Array types
  const arrayMatch = type.match(/^(.+)\[(\d+)\]$/);
  if (arrayMatch) {
    const baseSize = TYPE_SIZES[arrayMatch[1]] || 1;
    return baseSize * parseInt(arrayMatch[2], 10);
  }

  // FixedArray<T, N>
  const fixedArrayMatch = type.match(/^FixedArray<(.+),\s*(\d+)>$/);
  if (fixedArrayMatch) {
    const baseSize = TYPE_SIZES[fixedArrayMatch[1]] || 1;
    return baseSize * parseInt(fixedArrayMatch[2], 10);
  }

  return 0; // Unknown type
}

function calculateComplexityScore(c: StructComplexity): number {
  // Weighted scoring:
  // - Inheritance depth: 15% (deeper = more complex)
  // - VFunc count: 25% (more virtuals = more complex)
  // - Field coverage inverse: 20% (less documented = more work needed)
  // - Incoming refs: 25% (more refs = more central/important)
  // - Outgoing refs: 15% (more deps = more complex)

  const depthScore = Math.min(c.inheritanceDepth * 10, 100);
  const vfuncScore = Math.min(c.vfuncCount, 100);
  const coverageScore = 100 - c.fieldCoverage;
  const incomingScore = Math.min(c.incomingRefs * 2, 100);
  const outgoingScore = Math.min(c.outgoingRefs * 5, 100);

  return Math.round(
    depthScore * 0.15 +
    vfuncScore * 0.25 +
    coverageScore * 0.20 +
    incomingScore * 0.25 +
    outgoingScore * 0.15
  );
}

function buildInheritanceTrees(
  structs: YamlStruct[],
  structMap: Map<string, YamlStruct>
): InheritanceTree[] {
  // Find root structs (no base or base not in our set)
  const roots = structs.filter(
    s => !s.base || !structMap.has(s.base)
  );

  // Build child map
  const childMap = new Map<string, YamlStruct[]>();
  for (const struct of structs) {
    if (struct.base && structMap.has(struct.base)) {
      if (!childMap.has(struct.base)) {
        childMap.set(struct.base, []);
      }
      childMap.get(struct.base)!.push(struct);
    }
  }

  // Build trees
  const trees: InheritanceTree[] = [];

  for (const root of roots) {
    const tree = buildTreeNode(root, childMap);
    const depth = getTreeDepth(tree);
    const count = countTreeNodes(tree);

    if (count > 1) { // Only include trees with children
      trees.push({
        root: root.type,
        maxDepth: depth,
        totalStructs: count,
        children: tree.children,
      });
    }
  }

  // Sort by size
  trees.sort((a, b) => b.totalStructs - a.totalStructs);

  return trees;
}

function buildTreeNode(
  struct: YamlStruct,
  childMap: Map<string, YamlStruct[]>
): TreeNode {
  const children = childMap.get(struct.type) || [];

  return {
    type: struct.type,
    size: struct.size,
    vfuncCount: struct.vfuncs?.length || 0,
    children: children.map(c => buildTreeNode(c, childMap)),
  };
}

function getTreeDepth(node: TreeNode): number {
  if (node.children.length === 0) return 0;
  return 1 + Math.max(...node.children.map(getTreeDepth));
}

function countTreeNodes(node: TreeNode): number {
  return 1 + node.children.reduce((sum, c) => sum + countTreeNodes(c), 0);
}

function buildCrossRefSummary(
  complexities: StructComplexity[],
  structMap: Map<string, YamlStruct>
): CrossRefSummary {
  // Most referenced
  const mostReferenced = complexities
    .filter(c => c.incomingRefs > 0)
    .sort((a, b) => b.incomingRefs - a.incomingRefs)
    .slice(0, 20)
    .map(c => ({ type: c.type, count: c.incomingRefs }));

  // Orphans (no incoming refs and not a base class)
  const hasChildren = new Set<string>();
  for (const c of complexities) {
    if (c.inheritanceChain.length > 1) {
      hasChildren.add(c.inheritanceChain[1]); // Parent
    }
  }

  const orphans = complexities
    .filter(c => c.incomingRefs === 0 && !hasChildren.has(c.type))
    .map(c => c.type);

  // Detect circular references (simplified - just direct cycles)
  const circularRefs: string[][] = [];
  for (const c of complexities) {
    for (const ref of c.references) {
      const refComplexity = complexities.find(x => x.type === ref);
      if (refComplexity?.references.includes(c.type)) {
        const cycle = [c.type, ref].sort();
        if (!circularRefs.some(existing =>
          existing.length === 2 &&
          existing[0] === cycle[0] &&
          existing[1] === cycle[1]
        )) {
          circularRefs.push(cycle);
        }
      }
    }
  }

  return {
    mostReferenced,
    orphans,
    circularRefs,
  };
}

function calculateStats(complexities: StructComplexity[]): ComplexityStats {
  if (complexities.length === 0) {
    return {
      totalStructs: 0,
      avgInheritanceDepth: 0,
      maxInheritanceDepth: 0,
      avgFieldCoverage: 0,
      totalVFuncs: 0,
      avgComplexityScore: 0,
    };
  }

  const depths = complexities.map(c => c.inheritanceDepth);
  const coverages = complexities.map(c => c.fieldCoverage);
  const vfuncs = complexities.map(c => c.vfuncCount);
  const scores = complexities.map(c => c.complexityScore);

  return {
    totalStructs: complexities.length,
    avgInheritanceDepth: average(depths),
    maxInheritanceDepth: Math.max(...depths),
    avgFieldCoverage: average(coverages),
    totalVFuncs: sum(vfuncs),
    avgComplexityScore: average(scores),
  };
}

function sum(arr: number[]): number {
  return arr.reduce((a, b) => a + b, 0);
}

function average(arr: number[]): number {
  return arr.length > 0 ? Math.round(sum(arr) / arr.length) : 0;
}

// ============================================================================
// Formatting Functions
// ============================================================================

/**
 * Generate a Mermaid diagram for an inheritance tree
 */
export function generateInheritanceMermaid(tree: InheritanceTree): string {
  const lines: string[] = ['graph TD'];

  const addNode = (node: TreeNode, parentId?: string) => {
    const nodeId = sanitizeId(node.type);
    const label = node.type.split('.').pop() || node.type;
    const sizeStr = node.size ? ` (${toHex(node.size)})` : '';

    lines.push(`    ${nodeId}["${label}${sizeStr}"]`);

    if (parentId) {
      lines.push(`    ${parentId} --> ${nodeId}`);
    }

    for (const child of node.children) {
      addNode(child, nodeId);
    }
  };

  // Add root node
  const rootNode: TreeNode = {
    type: tree.root,
    vfuncCount: 0,
    children: tree.children,
  };
  addNode(rootNode);

  return lines.join('\n');
}

function sanitizeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9]/g, '_');
}

/**
 * Format complexity report as markdown table
 */
export function formatComplexityTable(
  complexities: StructComplexity[],
  limit = 20
): string {
  const lines: string[] = [];

  lines.push('| Struct | Depth | VFuncs | Coverage | Refs | Score |');
  lines.push('|--------|-------|--------|----------|------|-------|');

  for (const c of complexities.slice(0, limit)) {
    const shortName = c.type.split('.').pop() || c.type;
    lines.push(
      `| ${shortName} | ${c.inheritanceDepth} | ${c.vfuncCount} | ${c.fieldCoverage}% | ${c.incomingRefs} | ${c.complexityScore} |`
    );
  }

  return lines.join('\n');
}

export default { analyzeComplexity, generateInheritanceMermaid, formatComplexityTable };
