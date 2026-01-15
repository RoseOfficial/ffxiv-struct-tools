using System.Collections.Generic;
using System.Linq;
using StructValidator.Memory;

namespace StructValidator.Discovery;

/// <summary>
/// Comparison result between discovered and declared fields.
/// </summary>
public class FieldComparison
{
    public int Offset { get; set; }
    public string? DeclaredName { get; set; }
    public string? DeclaredType { get; set; }
    public int? DeclaredSize { get; set; }
    public InferredTypeKind? InferredType { get; set; }
    public float InferredConfidence { get; set; }
    public ComparisonStatus Status { get; set; }
    public string? Notes { get; set; }
}

/// <summary>
/// Status of a field comparison.
/// </summary>
public enum ComparisonStatus
{
    Match,           // Declared and discovered, types compatible
    TypeMismatch,    // Declared and discovered, but types differ
    MissingInMemory, // Declared but not discovered (may be complex type)
    Undocumented     // Discovered but not declared
}

/// <summary>
/// Result of comparing discovered layout with FFXIVClientStructs.
/// </summary>
public class LayoutComparisonResult
{
    public string StructName { get; set; } = "";
    public int? DeclaredSize { get; set; }
    public int? AnalyzedSize { get; set; }
    public bool SizeMatches => DeclaredSize == AnalyzedSize;
    public List<FieldComparison> Comparisons { get; set; } = new();

    public int MatchCount => Comparisons.Count(c => c.Status == ComparisonStatus.Match);
    public int MismatchCount => Comparisons.Count(c => c.Status == ComparisonStatus.TypeMismatch);
    public int MissingCount => Comparisons.Count(c => c.Status == ComparisonStatus.MissingInMemory);
    public int UndocumentedCount => Comparisons.Count(c => c.Status == ComparisonStatus.Undocumented);
}

/// <summary>
/// Compares discovered layouts with declared FFXIVClientStructs definitions.
/// </summary>
public static class LayoutComparator
{
    /// <summary>
    /// Compare a discovered layout with a validation result from FFXIVClientStructs.
    /// </summary>
    public static LayoutComparisonResult Compare(DiscoveredLayout discovered, StructValidationResult declared)
    {
        var result = new LayoutComparisonResult
        {
            StructName = declared.StructName,
            DeclaredSize = declared.DeclaredSize ?? declared.ActualSize,
            AnalyzedSize = discovered.AnalyzedSize
        };

        // Build lookup of declared fields by offset
        var declaredByOffset = new Dictionary<int, FieldValidation>();
        if (declared.FieldValidations != null)
        {
            foreach (var field in declared.FieldValidations)
            {
                declaredByOffset[field.Offset] = field;
            }
        }

        // Build lookup of discovered fields by offset
        var discoveredByOffset = new Dictionary<int, DiscoveredField>();
        foreach (var field in discovered.Fields)
        {
            discoveredByOffset[field.Offset] = field;
        }

        // Compare declared fields
        foreach (var declaredField in declaredByOffset.Values)
        {
            var comparison = new FieldComparison
            {
                Offset = declaredField.Offset,
                DeclaredName = declaredField.Name,
                DeclaredType = declaredField.Type,
                DeclaredSize = declaredField.Size
            };

            if (discoveredByOffset.TryGetValue(declaredField.Offset, out var discoveredField))
            {
                comparison.InferredType = discoveredField.InferredType;
                comparison.InferredConfidence = discoveredField.Confidence;

                // Check if types are compatible
                if (AreTypesCompatible(declaredField.Type, discoveredField.InferredType))
                {
                    comparison.Status = ComparisonStatus.Match;

                    // Update the discovered field with declared info
                    discoveredField.DeclaredName = declaredField.Name;
                    discoveredField.DeclaredType = declaredField.Type;
                }
                else
                {
                    comparison.Status = ComparisonStatus.TypeMismatch;
                    comparison.Notes = $"Declared: {declaredField.Type}, Inferred: {discoveredField.TypeString}";
                }
            }
            else
            {
                comparison.Status = ComparisonStatus.MissingInMemory;
                comparison.Notes = "Not detected (may be complex type or in padding region)";
            }

            result.Comparisons.Add(comparison);
        }

        // Find undocumented fields
        foreach (var discoveredField in discovered.Fields)
        {
            // Skip padding
            if (discoveredField.InferredType == InferredTypeKind.Padding)
                continue;

            if (!declaredByOffset.ContainsKey(discoveredField.Offset))
            {
                result.Comparisons.Add(new FieldComparison
                {
                    Offset = discoveredField.Offset,
                    InferredType = discoveredField.InferredType,
                    InferredConfidence = discoveredField.Confidence,
                    Status = ComparisonStatus.Undocumented,
                    Notes = $"Discovered {discoveredField.TypeString} (confidence: {discoveredField.Confidence:P0})"
                });
            }
        }

        // Sort by offset
        result.Comparisons.Sort((a, b) => a.Offset.CompareTo(b.Offset));

        return result;
    }

    /// <summary>
    /// Check if a declared type is compatible with an inferred type.
    /// </summary>
    private static bool AreTypesCompatible(string declaredType, InferredTypeKind inferredType)
    {
        // Normalize declared type name
        var normalizedDeclared = declaredType.ToLowerInvariant()
            .Replace("int32", "int")
            .Replace("int16", "short")
            .Replace("int64", "long")
            .Replace("uint32", "uint")
            .Replace("uint16", "ushort")
            .Replace("uint64", "ulong")
            .Replace("single", "float")
            .Replace("boolean", "bool");

        return inferredType switch
        {
            InferredTypeKind.Float => normalizedDeclared.Contains("float") || normalizedDeclared.Contains("single"),
            InferredTypeKind.Double => normalizedDeclared.Contains("double"),
            InferredTypeKind.Bool => normalizedDeclared.Contains("bool"),
            InferredTypeKind.Byte => normalizedDeclared == "byte" || normalizedDeclared.Contains("byte"),
            InferredTypeKind.Int16 => normalizedDeclared.Contains("short") || normalizedDeclared.Contains("int16"),
            InferredTypeKind.Int32 => normalizedDeclared.Contains("int") && !normalizedDeclared.Contains("nint") && !normalizedDeclared.Contains("64") && !normalizedDeclared.Contains("16"),
            InferredTypeKind.Int64 => normalizedDeclared.Contains("long") || normalizedDeclared.Contains("int64"),
            InferredTypeKind.Pointer or InferredTypeKind.VTablePointer or InferredTypeKind.StringPointer =>
                normalizedDeclared.Contains("*") || normalizedDeclared.Contains("pointer") || normalizedDeclared.Contains("nint") || normalizedDeclared.Contains("intptr"),
            InferredTypeKind.Enum => true, // Enums can match various underlying types
            _ => false
        };
    }

    /// <summary>
    /// Update a discovered layout with matches from a validation result.
    /// </summary>
    public static void UpdateWithDeclaredFields(DiscoveredLayout layout, StructValidationResult declared)
    {
        if (declared.FieldValidations == null)
            return;

        layout.DeclaredSize = declared.DeclaredSize ?? declared.ActualSize;

        var declaredByOffset = declared.FieldValidations.ToDictionary(f => f.Offset);

        foreach (var field in layout.Fields)
        {
            if (declaredByOffset.TryGetValue(field.Offset, out var declaredField))
            {
                field.DeclaredName = declaredField.Name;
                field.DeclaredType = declaredField.Type;
            }
        }

        // Update summary
        layout.Summary.MatchedFields = layout.Fields.Count(f => f.HasMatch);
        layout.Summary.UndocumentedFields = layout.Fields.Count(f => !f.HasMatch && f.InferredType != InferredTypeKind.Padding);
    }
}
