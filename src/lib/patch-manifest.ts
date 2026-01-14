/**
 * Patch manifest format for storing and applying detected delta patterns
 * This allows reviewing detected changes before applying them
 */

import type { HierarchyDeltaCandidate } from './diff-engine.js';
import type { PatchSet, Patch } from './patch-engine.js';
import { toHex } from './types.js';

// ============================================================================
// Manifest Types
// ============================================================================

export interface PatchManifest {
  /** Manifest format version */
  version: 1;
  /** When this manifest was generated */
  generatedAt: string;
  /** Source version/path */
  oldSource: string;
  /** Target version/path */
  newSource: string;
  /** Detected delta candidates by hierarchy */
  candidates: ManifestCandidate[];
  /** Summary statistics */
  summary: ManifestSummary;
}

export interface ManifestCandidate {
  /** Inheritance hierarchy root */
  hierarchy: string;
  /** All struct names in the hierarchy */
  structs: string[];
  /** Detected offset delta */
  delta: number;
  /** Human-readable delta (e.g., "+0x10") */
  deltaHex: string;
  /** Starting offset */
  startOffset: number;
  /** Human-readable start offset */
  startOffsetHex: string;
  /** Confidence score (0-1) */
  confidence: number;
  /** Confidence as percentage string */
  confidencePercent: string;
  /** Number of matching fields */
  matchCount: number;
  /** Total fields analyzed */
  totalFields: number;
  /** Whether to apply this candidate (can be toggled by user) */
  enabled: boolean;
  /** Suggested patch command */
  suggestedCommand: string;
  /** Anomalies that don't match the detected delta */
  anomalies: ManifestAnomaly[];
}

export interface ManifestAnomaly {
  struct: string;
  field: string;
  oldOffset: string;
  newOffset: string;
  actualDelta: string;
  expectedDelta: string;
}

export interface ManifestSummary {
  /** Total hierarchies with detected deltas */
  hierarchiesWithDeltas: number;
  /** Total structs affected */
  totalStructsAffected: number;
  /** Total fields that would be patched */
  totalFieldsAffected: number;
  /** High confidence candidates (>= 70%) */
  highConfidenceCandidates: number;
  /** Average confidence across all candidates */
  averageConfidence: number;
}

// ============================================================================
// Manifest Generation
// ============================================================================

/**
 * Generate a patch manifest from detected hierarchy deltas
 */
export function generateManifest(
  candidates: HierarchyDeltaCandidate[],
  oldSource: string,
  newSource: string
): PatchManifest {
  const manifestCandidates: ManifestCandidate[] = candidates.map(c => {
    const sign = c.delta >= 0 ? '+' : '';
    return {
      hierarchy: c.hierarchy,
      structs: c.structNames,
      delta: c.delta,
      deltaHex: `${sign}${toHex(c.delta)}`,
      startOffset: c.startOffset,
      startOffsetHex: toHex(c.startOffset),
      confidence: c.confidence,
      confidencePercent: `${(c.confidence * 100).toFixed(1)}%`,
      matchCount: c.matchCount,
      totalFields: c.totalFields,
      enabled: c.confidence >= 0.5, // Auto-enable high confidence candidates
      suggestedCommand: generateSuggestedCommand(c),
      anomalies: c.anomalies.map(a => ({
        struct: a.struct,
        field: a.field,
        oldOffset: toHex(a.oldOffset),
        newOffset: toHex(a.newOffset),
        actualDelta: `${a.actualDelta >= 0 ? '+' : ''}${toHex(a.actualDelta)}`,
        expectedDelta: `${c.delta >= 0 ? '+' : ''}${toHex(c.delta)}`,
      })),
    };
  });

  const enabledCandidates = manifestCandidates.filter(c => c.enabled);

  const summary: ManifestSummary = {
    hierarchiesWithDeltas: manifestCandidates.length,
    totalStructsAffected: new Set(manifestCandidates.flatMap(c => c.structs)).size,
    totalFieldsAffected: enabledCandidates.reduce((sum, c) => sum + c.matchCount, 0),
    highConfidenceCandidates: manifestCandidates.filter(c => c.confidence >= 0.7).length,
    averageConfidence: manifestCandidates.length > 0
      ? manifestCandidates.reduce((sum, c) => sum + c.confidence, 0) / manifestCandidates.length
      : 0,
  };

  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    oldSource,
    newSource,
    candidates: manifestCandidates,
    summary,
  };
}

/**
 * Generate a CLI command suggestion for a candidate
 */
function generateSuggestedCommand(candidate: HierarchyDeltaCandidate): string {
  const sign = candidate.delta >= 0 ? '+' : '';
  const structPattern = candidate.structNames.length === 1
    ? candidate.hierarchy
    : `${candidate.hierarchy}*`;

  return `ffxiv-struct-tools patch --delta ${sign}${toHex(candidate.delta)} --start-offset ${toHex(candidate.startOffset)} --struct "${structPattern}"`;
}

// ============================================================================
// Manifest to PatchSet Conversion
// ============================================================================

/**
 * Convert enabled manifest candidates to a PatchSet for application
 */
export function manifestToPatchSet(
  manifest: PatchManifest,
  options: {
    /** Override which candidates to include (by hierarchy name) */
    includeHierarchies?: string[];
    /** Minimum confidence threshold to include */
    minConfidence?: number;
  } = {}
): PatchSet {
  const { includeHierarchies, minConfidence = 0 } = options;

  const patches: Patch[] = [];

  for (const candidate of manifest.candidates) {
    // Skip if not enabled
    if (!candidate.enabled) continue;

    // Skip if below confidence threshold
    if (candidate.confidence < minConfidence) continue;

    // Skip if not in include list (if specified)
    if (includeHierarchies && !includeHierarchies.includes(candidate.hierarchy)) continue;

    // Create a patch for each struct in the hierarchy
    // Using wildcard pattern if multiple structs
    const structPattern = candidate.structs.length === 1
      ? candidate.hierarchy
      : `${candidate.hierarchy}*`;

    patches.push({
      type: 'shift_offset',
      structPattern,
      startOffset: candidate.startOffset,
      delta: candidate.delta,
    });
  }

  return {
    name: `Auto-detected patches from ${manifest.oldSource} → ${manifest.newSource}`,
    description: `Generated ${manifest.generatedAt}. ${manifest.summary.highConfidenceCandidates} high-confidence candidates.`,
    fromVersion: manifest.oldSource,
    toVersion: manifest.newSource,
    patches,
  };
}

// ============================================================================
// Manifest Serialization
// ============================================================================

/**
 * Serialize manifest to JSON
 */
export function serializeManifest(manifest: PatchManifest): string {
  return JSON.stringify(manifest, null, 2);
}

/**
 * Deserialize manifest from JSON
 */
export function deserializeManifest(json: string): PatchManifest {
  const parsed = JSON.parse(json) as PatchManifest;

  if (parsed.version !== 1) {
    throw new Error(`Unsupported manifest version: ${parsed.version}`);
  }

  if (!Array.isArray(parsed.candidates)) {
    throw new Error('Invalid manifest: missing candidates array');
  }

  return parsed;
}

// ============================================================================
// Manifest Display
// ============================================================================

/**
 * Format manifest for console display
 */
export function formatManifestSummary(manifest: PatchManifest): string {
  const lines: string[] = [];

  lines.push(`=== Patch Manifest ===`);
  lines.push(`Generated: ${manifest.generatedAt}`);
  lines.push(`Source: ${manifest.oldSource} → ${manifest.newSource}`);
  lines.push('');

  lines.push(`Summary:`);
  lines.push(`  Hierarchies with deltas: ${manifest.summary.hierarchiesWithDeltas}`);
  lines.push(`  Total structs affected: ${manifest.summary.totalStructsAffected}`);
  lines.push(`  Total fields affected: ${manifest.summary.totalFieldsAffected}`);
  lines.push(`  High confidence (≥70%): ${manifest.summary.highConfidenceCandidates}`);
  lines.push(`  Average confidence: ${(manifest.summary.averageConfidence * 100).toFixed(1)}%`);
  lines.push('');

  if (manifest.candidates.length === 0) {
    lines.push('No delta patterns detected.');
    return lines.join('\n');
  }

  lines.push('Detected Patterns:');
  lines.push('');

  for (const candidate of manifest.candidates) {
    const status = candidate.enabled ? '✓' : '○';
    const confidenceBar = '█'.repeat(Math.floor(candidate.confidence * 10)) +
                          '░'.repeat(10 - Math.floor(candidate.confidence * 10));

    lines.push(`${status} ${candidate.hierarchy} hierarchy`);
    lines.push(`  Delta: ${candidate.deltaHex} from ${candidate.startOffsetHex}`);
    lines.push(`  Confidence: [${confidenceBar}] ${candidate.confidencePercent}`);
    lines.push(`  Fields: ${candidate.matchCount}/${candidate.totalFields} match`);
    lines.push(`  Structs: ${candidate.structs.length} (${candidate.structs.slice(0, 3).join(', ')}${candidate.structs.length > 3 ? '...' : ''})`);

    if (candidate.anomalies.length > 0) {
      lines.push(`  ⚠ ${candidate.anomalies.length} anomalies (fields with different delta)`);
    }

    lines.push(`  Command: ${candidate.suggestedCommand}`);
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Format a single candidate for detailed display
 */
export function formatCandidateDetails(candidate: ManifestCandidate): string {
  const lines: string[] = [];

  lines.push(`=== ${candidate.hierarchy} Hierarchy ===`);
  lines.push(`Delta: ${candidate.deltaHex} starting at ${candidate.startOffsetHex}`);
  lines.push(`Confidence: ${candidate.confidencePercent} (${candidate.matchCount}/${candidate.totalFields} fields)`);
  lines.push(`Enabled: ${candidate.enabled ? 'Yes' : 'No'}`);
  lines.push('');

  lines.push(`Structs (${candidate.structs.length}):`);
  for (const struct of candidate.structs) {
    lines.push(`  - ${struct}`);
  }
  lines.push('');

  if (candidate.anomalies.length > 0) {
    lines.push(`Anomalies (${candidate.anomalies.length}):`);
    for (const anomaly of candidate.anomalies) {
      lines.push(`  ${anomaly.struct}.${anomaly.field}: ${anomaly.oldOffset} → ${anomaly.newOffset} (${anomaly.actualDelta}, expected ${anomaly.expectedDelta})`);
    }
    lines.push('');
  }

  lines.push(`Suggested command:`);
  lines.push(`  ${candidate.suggestedCommand}`);

  return lines.join('\n');
}
