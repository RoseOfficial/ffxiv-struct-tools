/**
 * Subsystem analyzers for FFXIVClientStructs
 * Specialized analysis for FFXIV-specific arcane subsystems
 */

import type { YamlStruct, YamlEnum } from '../types.js';
import { parseOffset, toHex } from '../types.js';

// ============================================================================
// Agent System Analysis
// ============================================================================

export interface AgentInfo {
  /** Agent struct name */
  name: string;
  /** Size of the agent struct */
  size?: number;
  /** Base class (direct parent) */
  base?: string;
  /** Full inheritance chain */
  inheritanceChain: string[];
  /** Functional category */
  category: AgentCategory;
  /** Has Instance() getter function */
  hasInstance: boolean;
  /** Virtual function count */
  vfuncCount: number;
  /** Field count */
  fieldCount: number;
  /** Notes/documentation */
  notes?: string;
}

export type AgentCategory =
  | 'Commerce'      // Shops, markets, trading
  | 'Communication' // Chat, party finder, contacts
  | 'Inventory'     // Items, armory, glamour
  | 'Combat'        // Actions, status, targeting
  | 'Social'        // Free company, linkshells, friends
  | 'UI'            // General UI management
  | 'World'         // Maps, weather, housing
  | 'Character'     // Character data, equipment
  | 'Quest'         // Quest log, duties
  | 'System'        // Core system agents
  | 'Unknown';

/**
 * Categorize an agent based on its name
 */
function categorizeAgent(name: string): AgentCategory {
  const lowerName = name.toLowerCase();

  // Commerce
  if (/shop|market|trade|retainer|mb|gil|vendor|exchange/.test(lowerName)) {
    return 'Commerce';
  }

  // Communication
  if (/chat|tell|linkshell|party.*finder|recruit|pvpteam|fellowship|message/.test(lowerName)) {
    return 'Communication';
  }

  // Inventory
  if (/inventory|item|armou?ry|glamour|equip|bag|chocobo.*bag|saddlebag|cabinets?/.test(lowerName)) {
    return 'Inventory';
  }

  // Combat
  if (/action|hotbar|status|target|combo|pvp(?!team)|battle|duty.*finder/.test(lowerName)) {
    return 'Combat';
  }

  // Social
  if (/freecompany|fc|friend|blacklist|social|cwls|cross.*world/.test(lowerName)) {
    return 'Social';
  }

  // World
  if (/map|weather|housing|gathering|fish|aether|teleport|minimap/.test(lowerName)) {
    return 'World';
  }

  // Character
  if (/character|chara(?!cter)|profile|title|mount|minion|card|companion/.test(lowerName)) {
    return 'Character';
  }

  // Quest
  if (/quest|journal|leve|tribal|beast|scenario|msq|duty(?!.*finder)/.test(lowerName)) {
    return 'Quest';
  }

  // System
  if (/system|config|hud|screen|window|context|cursor|banner|notify/.test(lowerName)) {
    return 'System';
  }

  // UI (fallback for UI-like patterns)
  if (/agent|addon|ui/.test(lowerName)) {
    return 'UI';
  }

  return 'Unknown';
}

export interface AgentSystemReport {
  /** Total number of agents found */
  totalAgents: number;
  /** Agents grouped by category */
  byCategory: Map<AgentCategory, AgentInfo[]>;
  /** Agents grouped by inheritance hierarchy */
  byHierarchy: Map<string, AgentInfo[]>;
  /** Agents without proper base class */
  missingBase: AgentInfo[];
  /** Statistics */
  stats: {
    withInstance: number;
    withVfuncs: number;
    avgSize: number;
    maxVfuncs: number;
  };
}

/**
 * Analyze the Agent system
 */
export function analyzeAgentSystem(structs: YamlStruct[]): AgentSystemReport {
  // Find all agent structs
  const agents: AgentInfo[] = [];
  const structMap = new Map(structs.map(s => [s.type, s]));

  for (const struct of structs) {
    if (!struct.type.startsWith('Agent') || struct.type === 'AgentInterface') {
      continue;
    }

    // Build inheritance chain
    const chain: string[] = [];
    let current: string | undefined = struct.base;
    while (current) {
      chain.push(current);
      const parent = structMap.get(current);
      current = parent?.base;
    }

    // Check for Instance() function
    const hasInstance = struct.funcs?.some(f =>
      f.name === 'Instance' || f.name === 'GetInstance' || f.name === 'Get'
    ) || false;

    agents.push({
      name: struct.type,
      size: struct.size,
      base: struct.base,
      inheritanceChain: chain,
      category: categorizeAgent(struct.type),
      hasInstance,
      vfuncCount: struct.vfuncs?.length || 0,
      fieldCount: struct.fields?.length || 0,
      notes: struct.notes,
    });
  }

  // Group by category
  const byCategory = new Map<AgentCategory, AgentInfo[]>();
  for (const agent of agents) {
    if (!byCategory.has(agent.category)) {
      byCategory.set(agent.category, []);
    }
    byCategory.get(agent.category)!.push(agent);
  }

  // Group by base hierarchy
  const byHierarchy = new Map<string, AgentInfo[]>();
  for (const agent of agents) {
    const root = agent.inheritanceChain.length > 0
      ? agent.inheritanceChain[agent.inheritanceChain.length - 1]
      : agent.base || 'None';
    if (!byHierarchy.has(root)) {
      byHierarchy.set(root, []);
    }
    byHierarchy.get(root)!.push(agent);
  }

  // Find agents without proper base
  const missingBase = agents.filter(a =>
    !a.base || (!a.base.startsWith('Agent') && a.base !== 'AgentInterface')
  );

  // Calculate stats
  const sizes = agents.filter(a => a.size).map(a => a.size!);
  const avgSize = sizes.length > 0 ? sizes.reduce((a, b) => a + b, 0) / sizes.length : 0;
  const maxVfuncs = Math.max(0, ...agents.map(a => a.vfuncCount));

  return {
    totalAgents: agents.length,
    byCategory,
    byHierarchy,
    missingBase,
    stats: {
      withInstance: agents.filter(a => a.hasInstance).length,
      withVfuncs: agents.filter(a => a.vfuncCount > 0).length,
      avgSize: Math.round(avgSize),
      maxVfuncs,
    },
  };
}

// ============================================================================
// ATK/UI Component Analysis
// ============================================================================

export interface AtkComponentInfo {
  /** Component struct name */
  name: string;
  /** Size of the component */
  size?: number;
  /** Component type category */
  componentType: AtkComponentType;
  /** Base class */
  base?: string;
  /** Has event listener at offset 0 */
  hasEventListener: boolean;
  /** Virtual function count */
  vfuncCount: number;
  /** Field count */
  fieldCount: number;
  /** Inherits from AtkResNode hierarchy */
  isResNode: boolean;
  /** Notes */
  notes?: string;
}

export type AtkComponentType =
  | 'Text'        // Text display nodes
  | 'Image'       // Image/icon nodes
  | 'Interactive' // Buttons, checkboxes
  | 'Container'   // Containers, lists
  | 'Window'      // Windows, dialogs
  | 'Input'       // Text input, sliders
  | 'Data'        // Data structures, array data
  | 'Base'        // Base node types
  | 'Unknown';

function categorizeAtkComponent(name: string): AtkComponentType {
  const lowerName = name.toLowerCase();

  if (/text|string|sestring/.test(lowerName)) return 'Text';
  if (/image|icon|texture|ninegrid|tile/.test(lowerName)) return 'Image';
  if (/button|checkbox|radio|toggle|tabbar|scrollbar/.test(lowerName)) return 'Interactive';
  if (/list|tree|grid|container|collision|compound/.test(lowerName)) return 'Container';
  if (/window|dialog|tooltip|component(?!node)/.test(lowerName)) return 'Window';
  if (/input|slider|numericin|dragdrop/.test(lowerName)) return 'Input';
  if (/array|value|data|simple/.test(lowerName)) return 'Data';
  if (/resnode|componentnode|base/.test(lowerName)) return 'Base';

  return 'Unknown';
}

export interface AtkSystemReport {
  /** Total ATK components found */
  totalComponents: number;
  /** Components by type */
  byType: Map<AtkComponentType, AtkComponentInfo[]>;
  /** AtkResNode hierarchy */
  resNodeHierarchy: AtkComponentInfo[];
  /** Components without event listener */
  missingEventListener: AtkComponentInfo[];
  /** Statistics */
  stats: {
    avgSize: number;
    maxVfuncs: number;
    withVfuncs: number;
  };
}

/**
 * Analyze the ATK/UI component system
 */
export function analyzeAtkSystem(structs: YamlStruct[]): AtkSystemReport {
  const components: AtkComponentInfo[] = [];
  const structMap = new Map(structs.map(s => [s.type, s]));

  // Recursively check if a struct inherits from AtkResNode
  function inheritsFromResNode(structName: string, visited = new Set<string>()): boolean {
    if (visited.has(structName)) return false;
    visited.add(structName);

    if (structName === 'AtkResNode') return true;
    const struct = structMap.get(structName);
    if (!struct?.base) return false;
    return inheritsFromResNode(struct.base, visited);
  }

  for (const struct of structs) {
    // Match ATK types
    if (!struct.type.startsWith('Atk')) continue;

    // Check for event listener at offset 0
    const firstField = struct.fields?.find(f => parseOffset(f.offset) === 0);
    const hasEventListener = firstField ? (
      firstField.type.includes('AtkEventListener') ||
      firstField.type.includes('AtkResNode') ||
      firstField.type.includes('AtkComponentNode') ||
      firstField.type.endsWith('*')
    ) : false;

    components.push({
      name: struct.type,
      size: struct.size,
      componentType: categorizeAtkComponent(struct.type),
      base: struct.base,
      hasEventListener: hasEventListener || !!struct.base,
      vfuncCount: struct.vfuncs?.length || 0,
      fieldCount: struct.fields?.length || 0,
      isResNode: inheritsFromResNode(struct.type),
      notes: struct.notes,
    });
  }

  // Group by type
  const byType = new Map<AtkComponentType, AtkComponentInfo[]>();
  for (const comp of components) {
    if (!byType.has(comp.componentType)) {
      byType.set(comp.componentType, []);
    }
    byType.get(comp.componentType)!.push(comp);
  }

  // Filter AtkResNode hierarchy
  const resNodeHierarchy = components.filter(c => c.isResNode);

  // Missing event listener (for root components only)
  const missingEventListener = components.filter(c => !c.hasEventListener && !c.base);

  // Stats
  const sizes = components.filter(c => c.size).map(c => c.size!);
  const avgSize = sizes.length > 0 ? sizes.reduce((a, b) => a + b, 0) / sizes.length : 0;
  const maxVfuncs = Math.max(0, ...components.map(c => c.vfuncCount));

  return {
    totalComponents: components.length,
    byType,
    resNodeHierarchy,
    missingEventListener,
    stats: {
      avgSize: Math.round(avgSize),
      maxVfuncs,
      withVfuncs: components.filter(c => c.vfuncCount > 0).length,
    },
  };
}

// ============================================================================
// Network Packet Analysis
// ============================================================================

export interface PacketInfo {
  /** Packet struct name */
  name: string;
  /** Packet size */
  size?: number;
  /** Direction (inferred from name) */
  direction: 'client' | 'server' | 'bidirectional' | 'unknown';
  /** Category */
  category: string;
  /** Field count */
  fieldCount: number;
  /** Common fields detected */
  commonFields: string[];
  /** Notes */
  notes?: string;
}

export interface NetworkReport {
  /** Total packets found */
  totalPackets: number;
  /** Packets by direction */
  byDirection: {
    client: PacketInfo[];
    server: PacketInfo[];
    bidirectional: PacketInfo[];
    unknown: PacketInfo[];
  };
  /** Size distribution */
  sizeDistribution: {
    small: number;   // < 64 bytes
    medium: number;  // 64-256 bytes
    large: number;   // > 256 bytes
  };
  /** Common field patterns */
  commonPatterns: { pattern: string; count: number }[];
  /** Statistics */
  stats: {
    avgSize: number;
    minSize: number;
    maxSize: number;
  };
}

function inferPacketDirection(name: string): PacketInfo['direction'] {
  const lower = name.toLowerCase();
  if (lower.startsWith('client') || lower.includes('request') || lower.includes('send')) {
    return 'client';
  }
  if (lower.startsWith('server') || lower.includes('response') || lower.includes('receive')) {
    return 'server';
  }
  if (lower.includes('ipc') || lower.includes('packet')) {
    return 'bidirectional';
  }
  return 'unknown';
}

/**
 * Analyze network packet structures
 */
export function analyzeNetworkPackets(structs: YamlStruct[]): NetworkReport {
  const packets: PacketInfo[] = [];

  for (const struct of structs) {
    // Match packet-like types
    const isPacket = struct.type.includes('Packet') ||
      struct.type.includes('IPC') ||
      struct.type.startsWith('Server') ||
      struct.type.startsWith('Client');

    if (!isPacket) continue;

    // Find common fields
    const commonFields: string[] = [];
    for (const field of struct.fields || []) {
      const name = (field.name || '').toLowerCase();
      if (name.includes('size') || name.includes('length')) commonFields.push('size');
      if (name.includes('opcode') || name.includes('type') || name.includes('id')) commonFields.push('opcode/type');
      if (name.includes('timestamp') || name.includes('time')) commonFields.push('timestamp');
      if (name.includes('sequence') || name.includes('seq')) commonFields.push('sequence');
    }

    packets.push({
      name: struct.type,
      size: struct.size,
      direction: inferPacketDirection(struct.type),
      category: struct.category || 'General',
      fieldCount: struct.fields?.length || 0,
      commonFields: [...new Set(commonFields)],
      notes: struct.notes,
    });
  }

  // Group by direction
  const byDirection = {
    client: packets.filter(p => p.direction === 'client'),
    server: packets.filter(p => p.direction === 'server'),
    bidirectional: packets.filter(p => p.direction === 'bidirectional'),
    unknown: packets.filter(p => p.direction === 'unknown'),
  };

  // Size distribution
  const sizeDistribution = {
    small: packets.filter(p => p.size && p.size < 64).length,
    medium: packets.filter(p => p.size && p.size >= 64 && p.size <= 256).length,
    large: packets.filter(p => p.size && p.size > 256).length,
  };

  // Common patterns
  const patternCounts = new Map<string, number>();
  for (const packet of packets) {
    for (const field of packet.commonFields) {
      patternCounts.set(field, (patternCounts.get(field) || 0) + 1);
    }
  }
  const commonPatterns = [...patternCounts.entries()]
    .map(([pattern, count]) => ({ pattern, count }))
    .sort((a, b) => b.count - a.count);

  // Stats
  const sizes = packets.filter(p => p.size).map(p => p.size!);
  const avgSize = sizes.length > 0 ? sizes.reduce((a, b) => a + b, 0) / sizes.length : 0;
  const minSize = sizes.length > 0 ? Math.min(...sizes) : 0;
  const maxSize = sizes.length > 0 ? Math.max(...sizes) : 0;

  return {
    totalPackets: packets.length,
    byDirection,
    sizeDistribution,
    commonPatterns,
    stats: {
      avgSize: Math.round(avgSize),
      minSize,
      maxSize,
    },
  };
}

// ============================================================================
// Singleton/Manager Analysis
// ============================================================================

export interface SingletonInfo {
  /** Struct name */
  name: string;
  /** Size */
  size?: number;
  /** Subsystem category */
  subsystem: SingletonSubsystem;
  /** Has Instance() function */
  hasInstance: boolean;
  /** Instance function signature */
  instanceSignature?: string;
  /** Has Initialize/Deinitialize */
  hasInitialize: boolean;
  /** Potential dependencies (types referenced) */
  dependencies: string[];
  /** Notes */
  notes?: string;
}

export type SingletonSubsystem =
  | 'UI'        // UI managers
  | 'Network'   // Network/IPC managers
  | 'Combat'    // Combat system managers
  | 'Items'     // Inventory/item managers
  | 'World'     // World/zone managers
  | 'Social'    // Social system managers
  | 'Character' // Character managers
  | 'System'    // Core system managers
  | 'Audio'     // Audio managers
  | 'Graphics'  // Rendering managers
  | 'Unknown';

function categorizeSubsystem(name: string): SingletonSubsystem {
  const lower = name.toLowerCase();

  if (/ui|hud|addon|window|screen|cursor/.test(lower)) return 'UI';
  if (/network|ipc|packet|connection/.test(lower)) return 'Network';
  if (/combat|action|status|buff|battle|target/.test(lower)) return 'Combat';
  if (/item|inventory|equip|glamour|armou?ry/.test(lower)) return 'Items';
  if (/world|zone|map|weather|territory|housing/.test(lower)) return 'World';
  if (/social|friend|party|fc|linkshell|chat/.test(lower)) return 'Social';
  if (/character|player|chara|profile/.test(lower)) return 'Character';
  if (/audio|sound|bgm|se|voice/.test(lower)) return 'Audio';
  if (/render|graphics|shader|scene|model/.test(lower)) return 'Graphics';
  if (/system|framework|config|module|controller|service/.test(lower)) return 'System';

  return 'Unknown';
}

export interface SingletonReport {
  /** Total singletons found */
  totalSingletons: number;
  /** Singletons by subsystem */
  bySubsystem: Map<SingletonSubsystem, SingletonInfo[]>;
  /** Potential singletons missing Instance() */
  missingInstance: SingletonInfo[];
  /** Dependency graph (simplified) */
  dependencyGroups: { singleton: string; dependencies: string[] }[];
  /** Statistics */
  stats: {
    withInstance: number;
    withInitialize: number;
    avgDependencies: number;
  };
}

/**
 * Analyze singleton/manager structures
 */
export function analyzeSingletons(structs: YamlStruct[]): SingletonReport {
  const singletons: SingletonInfo[] = [];
  const structNames = new Set(structs.map(s => s.type));

  // Common singleton indicators
  const singletonIndicators = [
    'Manager', 'Module', 'System', 'Framework', 'Controller', 'Service',
    'Handler', 'Registry', 'Cache', 'Pool', 'Factory',
  ];

  for (const struct of structs) {
    const isSingletonLike = singletonIndicators.some(ind =>
      struct.type.includes(ind)
    );

    if (!isSingletonLike) continue;

    // Check for Instance() function
    const instanceFunc = struct.funcs?.find(f =>
      f.name === 'Instance' || f.name === 'GetInstance' || f.name === 'Get'
    );
    const hasInstance = !!instanceFunc;

    // Check for Initialize/Deinitialize
    const hasInitialize = struct.funcs?.some(f =>
      f.name?.toLowerCase().includes('initialize') ||
      f.name?.toLowerCase().includes('deinitialize') ||
      f.name?.toLowerCase().includes('init') ||
      f.name?.toLowerCase().includes('shutdown')
    ) || false;

    // Find dependencies (types referenced in fields)
    const dependencies: string[] = [];
    for (const field of struct.fields || []) {
      // Extract type references
      const typeMatch = field.type.match(/^(?:Pointer<)?(\w+)/);
      if (typeMatch && structNames.has(typeMatch[1]) && typeMatch[1] !== struct.type) {
        dependencies.push(typeMatch[1]);
      }
    }

    singletons.push({
      name: struct.type,
      size: struct.size,
      subsystem: categorizeSubsystem(struct.type),
      hasInstance,
      instanceSignature: instanceFunc?.signature,
      hasInitialize,
      dependencies: [...new Set(dependencies)],
      notes: struct.notes,
    });
  }

  // Group by subsystem
  const bySubsystem = new Map<SingletonSubsystem, SingletonInfo[]>();
  for (const singleton of singletons) {
    if (!bySubsystem.has(singleton.subsystem)) {
      bySubsystem.set(singleton.subsystem, []);
    }
    bySubsystem.get(singleton.subsystem)!.push(singleton);
  }

  // Find potential singletons missing Instance()
  const missingInstance = singletons.filter(s => !s.hasInstance);

  // Build dependency groups
  const dependencyGroups = singletons
    .filter(s => s.dependencies.length > 0)
    .map(s => ({ singleton: s.name, dependencies: s.dependencies }))
    .sort((a, b) => b.dependencies.length - a.dependencies.length);

  // Stats
  const avgDependencies = singletons.length > 0
    ? singletons.reduce((sum, s) => sum + s.dependencies.length, 0) / singletons.length
    : 0;

  return {
    totalSingletons: singletons.length,
    bySubsystem,
    missingInstance,
    dependencyGroups,
    stats: {
      withInstance: singletons.filter(s => s.hasInstance).length,
      withInitialize: singletons.filter(s => s.hasInitialize).length,
      avgDependencies: Math.round(avgDependencies * 10) / 10,
    },
  };
}

// ============================================================================
// Combined System Report
// ============================================================================

export interface SystemReport {
  agents: AgentSystemReport;
  atk: AtkSystemReport;
  network: NetworkReport;
  singletons: SingletonReport;
}

/**
 * Run all subsystem analyzers
 */
export function analyzeAllSubsystems(structs: YamlStruct[]): SystemReport {
  return {
    agents: analyzeAgentSystem(structs),
    atk: analyzeAtkSystem(structs),
    network: analyzeNetworkPackets(structs),
    singletons: analyzeSingletons(structs),
  };
}
