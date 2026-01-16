/**
 * Signature validation against YAML definitions
 * Cross-references signature files with YAML struct definitions to detect mismatches
 */

import { toHex, parseOffset, type YamlStruct, type YamlField } from './types.js';
import type { Signature, StructSignatures } from './signatures.js';

// ============================================================================
// Validation Types
// ============================================================================

export type ValidationIssueType =
  | 'offset_mismatch'      // Signature offset doesn't match YAML field offset
  | 'missing_field'        // Signature references a field not in YAML
  | 'missing_signature'    // YAML field has no corresponding signature
  | 'struct_not_found'     // Signature references unknown struct
  | 'type_mismatch'        // Field type in signature doesn't match YAML
  | 'stale_signature'      // Signature appears outdated
  | 'duplicate_signature'  // Multiple signatures for same field;

export interface SignatureValidationIssue {
  type: ValidationIssueType;
  severity: 'error' | 'warning' | 'info';
  structName: string;
  fieldName?: string;
  message: string;
  details?: {
    signatureOffset?: number;
    yamlOffset?: number;
    delta?: number;
    signatureConfidence?: number;
  };
  suggestedFix?: string;
}

export interface SignatureValidationResult {
  /** Total signatures validated */
  signaturesChecked: number;
  /** Signatures that passed validation */
  signaturesValid: number;
  /** Signatures with issues */
  signaturesWithIssues: number;
  /** Total structs covered by signatures */
  structsCovered: number;
  /** Structs in YAML without any signatures */
  structsWithoutSignatures: number;
  /** Fields in YAML without signatures */
  fieldsCoverage: {
    total: number;
    covered: number;
    percentage: number;
  };
  /** Individual issues found */
  issues: SignatureValidationIssue[];
  /** Suggested patch commands if mismatches detected */
  suggestedPatches: SuggestedPatch[];
}

export interface SuggestedPatch {
  structName: string;
  fieldName: string;
  currentOffset: number;
  suggestedOffset: number;
  confidence: number;
  command: string;
}

// ============================================================================
// Validation Logic
// ============================================================================

/**
 * Validate signatures against YAML struct definitions
 */
export function validateSignatures(
  signatures: StructSignatures[],
  structs: YamlStruct[]
): SignatureValidationResult {
  const issues: SignatureValidationIssue[] = [];
  const suggestedPatches: SuggestedPatch[] = [];

  // Build lookup maps
  const structMap = new Map<string, YamlStruct>();
  for (const struct of structs) {
    if (struct.type) {
      structMap.set(struct.type, struct);
    }
  }

  const signatureMap = new Map<string, StructSignatures>();
  for (const sigCollection of signatures) {
    signatureMap.set(sigCollection.struct, sigCollection);
  }

  let signaturesChecked = 0;
  let signaturesValid = 0;
  let signaturesWithIssues = 0;
  const structsWithSignatures = new Set<string>();
  let totalFields = 0;
  let coveredFields = 0;

  // Validate each signature collection
  for (const sigCollection of signatures) {
    const struct = structMap.get(sigCollection.struct);

    if (!struct) {
      issues.push({
        type: 'struct_not_found',
        severity: 'error',
        structName: sigCollection.struct,
        message: `Signature references unknown struct '${sigCollection.struct}' not found in YAML definitions`,
      });
      signaturesWithIssues += sigCollection.signatures.length;
      continue;
    }

    structsWithSignatures.add(sigCollection.struct);

    // Build field lookup for this struct
    const fieldMap = new Map<string, YamlField>();
    for (const field of struct.fields || []) {
      const fieldName = field.name || `field_${toHex(parseOffset(field.offset))}`;
      fieldMap.set(fieldName, field);
    }

    // Track which fields have signatures
    const fieldsWithSignatures = new Set<string>();

    // Check each signature
    for (const sig of sigCollection.signatures) {
      signaturesChecked++;

      // Skip non-field signatures (like RTTI)
      if (sig.type !== 'field_access') {
        signaturesValid++;
        continue;
      }

      const field = fieldMap.get(sig.field);
      fieldsWithSignatures.add(sig.field);

      if (!field) {
        issues.push({
          type: 'missing_field',
          severity: 'warning',
          structName: sigCollection.struct,
          fieldName: sig.field,
          message: `Signature references field '${sig.field}' not found in YAML struct`,
          details: {
            signatureOffset: sig.offset,
            signatureConfidence: sig.confidence,
          },
        });
        signaturesWithIssues++;
        continue;
      }

      const yamlOffset = parseOffset(field.offset);

      if (sig.offset !== yamlOffset) {
        const delta = sig.offset - yamlOffset;
        const severity = Math.abs(delta) > 0x100 ? 'error' : 'warning';

        issues.push({
          type: 'offset_mismatch',
          severity,
          structName: sigCollection.struct,
          fieldName: sig.field,
          message: `Signature offset ${toHex(sig.offset)} doesn't match YAML offset ${toHex(yamlOffset)} (delta: ${delta >= 0 ? '+' : ''}${toHex(delta)})`,
          details: {
            signatureOffset: sig.offset,
            yamlOffset,
            delta,
            signatureConfidence: sig.confidence,
          },
          suggestedFix: sig.confidence >= 70
            ? `Update YAML field offset to ${toHex(sig.offset)}`
            : `Verify which offset is correct (sig confidence: ${sig.confidence}%)`,
        });

        signaturesWithIssues++;

        // Generate patch suggestion if signature confidence is high
        if (sig.confidence >= 70) {
          suggestedPatches.push({
            structName: sigCollection.struct,
            fieldName: sig.field,
            currentOffset: yamlOffset,
            suggestedOffset: sig.offset,
            confidence: sig.confidence,
            command: `# Update ${sigCollection.struct}.${sig.field}: ${toHex(yamlOffset)} -> ${toHex(sig.offset)}`,
          });
        }

        continue;
      }

      signaturesValid++;
    }

    // Count coverage for this struct
    totalFields += fieldMap.size;
    coveredFields += fieldsWithSignatures.size;
  }

  // Check for structs without any signatures
  const structsWithoutSignatures: string[] = [];
  for (const struct of structs) {
    if (struct.type && !structsWithSignatures.has(struct.type)) {
      // Only report structs with fields
      if (struct.fields && struct.fields.length > 0) {
        structsWithoutSignatures.push(struct.type);
      }
    }
  }

  // Add info-level issues for uncovered structs (only in verbose/strict mode)
  // We don't add these by default to avoid noise

  return {
    signaturesChecked,
    signaturesValid,
    signaturesWithIssues,
    structsCovered: structsWithSignatures.size,
    structsWithoutSignatures: structsWithoutSignatures.length,
    fieldsCoverage: {
      total: totalFields,
      covered: coveredFields,
      percentage: totalFields > 0 ? Math.round((coveredFields / totalFields) * 100) : 0,
    },
    issues,
    suggestedPatches,
  };
}

/**
 * Group validation issues by struct for easier reporting
 */
export function groupIssuesByStruct(
  issues: SignatureValidationIssue[]
): Map<string, SignatureValidationIssue[]> {
  const grouped = new Map<string, SignatureValidationIssue[]>();

  for (const issue of issues) {
    if (!grouped.has(issue.structName)) {
      grouped.set(issue.structName, []);
    }
    grouped.get(issue.structName)!.push(issue);
  }

  return grouped;
}

/**
 * Detect bulk offset shifts from validation issues
 * Returns suggested patch commands for systematic offsets
 */
export function detectBulkShifts(
  issues: SignatureValidationIssue[]
): { delta: number; count: number; structs: string[]; command: string }[] {
  // Only consider offset mismatches
  const offsetIssues = issues.filter(
    (i) => i.type === 'offset_mismatch' && i.details?.delta !== undefined
  );

  if (offsetIssues.length < 2) return [];

  // Group by delta
  const byDelta = new Map<number, SignatureValidationIssue[]>();
  for (const issue of offsetIssues) {
    const delta = issue.details!.delta!;
    if (!byDelta.has(delta)) {
      byDelta.set(delta, []);
    }
    byDelta.get(delta)!.push(issue);
  }

  // Find deltas that appear multiple times
  const shifts: { delta: number; count: number; structs: string[]; command: string }[] = [];

  for (const [delta, deltaIssues] of byDelta) {
    if (deltaIssues.length >= 2) {
      const structs = [...new Set(deltaIssues.map((i) => i.structName))];
      const sign = delta >= 0 ? '+' : '';

      shifts.push({
        delta,
        count: deltaIssues.length,
        structs,
        command: structs.length === 1
          ? `fst patch --struct "${structs[0]}" --delta ${sign}${toHex(delta)}`
          : `# Multiple structs with ${sign}${toHex(delta)} delta: ${structs.join(', ')}`,
      });
    }
  }

  // Sort by count (most common shifts first)
  shifts.sort((a, b) => b.count - a.count);

  return shifts;
}
