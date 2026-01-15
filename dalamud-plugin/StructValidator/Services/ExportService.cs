using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using System.Text.Json;
using System.Threading.Tasks;
using Dalamud.Plugin.Services;
using StructValidator.Discovery;
using StructValidator.Models;

namespace StructValidator.Services;

/// <summary>
/// Service for exporting analysis results in various formats.
/// </summary>
public class ExportService
{
    private readonly IPluginLog _log;
    private readonly JsonSerializerOptions _jsonOptions;

    public ExportService(IPluginLog log)
    {
        _log = log;
        _jsonOptions = new JsonSerializerOptions
        {
            WriteIndented = true,
            PropertyNamingPolicy = JsonNamingPolicy.CamelCase
        };
    }

    /// <summary>
    /// Export analysis result to JSON format.
    /// </summary>
    public async Task<string> ExportToJsonAsync(AnalysisResult result)
    {
        return await Task.Run(() => JsonSerializer.Serialize(result, _jsonOptions));
    }

    /// <summary>
    /// Export analysis result to JSON file.
    /// </summary>
    public async Task ExportToJsonFileAsync(AnalysisResult result, string filePath)
    {
        var json = await ExportToJsonAsync(result);
        await File.WriteAllTextAsync(filePath, json);
        _log.Info($"Exported JSON to: {filePath}");
    }

    /// <summary>
    /// Export discovered layout to YAML format for FFXIVClientStructs.
    /// </summary>
    public string ExportToYaml(DiscoveredLayout layout)
    {
        var sb = new StringBuilder();

        sb.AppendLine($"# Auto-discovered layout for {layout.StructName}");
        sb.AppendLine($"# Analyzed: {layout.Timestamp:yyyy-MM-dd HH:mm:ss}");
        sb.AppendLine($"# Address: {layout.BaseAddressHex}");
        sb.AppendLine();
        sb.AppendLine("structs:");
        sb.AppendLine($"  - type: {layout.StructName}_Discovered");

        if (layout.DeclaredSize.HasValue)
            sb.AppendLine($"    size: 0x{layout.DeclaredSize.Value:X}");
        else
            sb.AppendLine($"    size: 0x{layout.AnalyzedSize:X}");

        sb.AppendLine("    fields:");

        foreach (var field in layout.Fields.OrderBy(f => f.Offset))
        {
            // Skip padding in YAML output
            if (field.InferredType == Memory.InferredTypeKind.Padding)
                continue;

            var fieldType = GetYamlType(field);
            var fieldName = field.DeclaredName ?? $"Unknown_0x{field.Offset:X}";

            sb.AppendLine($"      - type: {fieldType}");
            sb.AppendLine($"        name: {fieldName}");
            sb.AppendLine($"        offset: 0x{field.Offset:X}");

            if (field.Confidence < 0.7f)
                sb.AppendLine($"        # confidence: {field.Confidence:P0}");
        }

        return sb.ToString();
    }

    /// <summary>
    /// Export analysis result to Markdown report.
    /// </summary>
    public string ExportToMarkdown(AnalysisResult result)
    {
        var sb = new StringBuilder();

        sb.AppendLine($"# Analysis Report: {result.StructName}");
        sb.AppendLine();
        sb.AppendLine($"**Analyzed:** {result.Timestamp:yyyy-MM-dd HH:mm:ss}");
        sb.AppendLine($"**Game Version:** {result.GameVersion}");
        sb.AppendLine($"**Address:** {result.AddressHex}");
        sb.AppendLine();

        if (result.Discovery != null)
        {
            sb.AppendLine("## Discovery Summary");
            sb.AppendLine();
            sb.AppendLine($"| Metric | Value |");
            sb.AppendLine($"|--------|-------|");
            sb.AppendLine($"| Analyzed Size | 0x{result.Discovery.AnalyzedSize:X} |");
            if (result.Discovery.DeclaredSize.HasValue)
                sb.AppendLine($"| Declared Size | 0x{result.Discovery.DeclaredSize.Value:X} |");
            sb.AppendLine($"| Total Fields | {result.Discovery.Summary.TotalFields} |");
            sb.AppendLine($"| High Confidence | {result.Discovery.Summary.HighConfidenceFields} |");
            sb.AppendLine($"| Matched Fields | {result.Discovery.Summary.MatchedFields} |");
            sb.AppendLine($"| Undocumented | {result.Discovery.Summary.UndocumentedFields} |");
            sb.AppendLine($"| Pointers | {result.Discovery.Summary.PointerCount} |");
            sb.AppendLine();
        }

        if (result.Comparison != null)
        {
            sb.AppendLine("## Comparison Results");
            sb.AppendLine();
            sb.AppendLine($"| Status | Count |");
            sb.AppendLine($"|--------|-------|");
            sb.AppendLine($"| Match | {result.Comparison.MatchCount} |");
            sb.AppendLine($"| Type Mismatch | {result.Comparison.MismatchCount} |");
            sb.AppendLine($"| Missing in Memory | {result.Comparison.MissingCount} |");
            sb.AppendLine($"| Undocumented | {result.Comparison.UndocumentedCount} |");
            sb.AppendLine();

            if (result.Comparison.Comparisons.Any(c => c.Status != ComparisonStatus.Match))
            {
                sb.AppendLine("### Issues");
                sb.AppendLine();
                sb.AppendLine($"| Offset | Status | Declared | Inferred | Notes |");
                sb.AppendLine($"|--------|--------|----------|----------|-------|");

                foreach (var comp in result.Comparison.Comparisons.Where(c => c.Status != ComparisonStatus.Match))
                {
                    var status = comp.Status switch
                    {
                        ComparisonStatus.TypeMismatch => "Type Mismatch",
                        ComparisonStatus.MissingInMemory => "Missing",
                        ComparisonStatus.Undocumented => "Undocumented",
                        _ => comp.Status.ToString()
                    };
                    sb.AppendLine($"| 0x{comp.Offset:X} | {status} | {comp.DeclaredType ?? "-"} | {comp.InferredType?.ToString() ?? "-"} | {comp.Notes ?? ""} |");
                }
                sb.AppendLine();
            }
        }

        if (result.DetectedArrays != null && result.DetectedArrays.Count > 0)
        {
            sb.AppendLine("## Detected Arrays");
            sb.AppendLine();
            sb.AppendLine($"| Offset | Stride | Count | Total Size | Confidence |");
            sb.AppendLine($"|--------|--------|-------|------------|------------|");

            foreach (var array in result.DetectedArrays.OrderBy(a => a.Offset))
            {
                sb.AppendLine($"| 0x{array.Offset:X} | {array.Stride} | {array.Count} | {array.TotalSize} | {array.Confidence:P0} |");
            }
            sb.AppendLine();
        }

        if (result.VTable != null)
        {
            sb.AppendLine("## VTable Analysis");
            sb.AppendLine();
            sb.AppendLine($"**Address:** {result.VTable.AddressHex}");
            sb.AppendLine($"**Slots:** {result.VTable.SlotCount}");
            sb.AppendLine($"**Confidence:** {result.VTable.Confidence:P0}");
            sb.AppendLine();

            if (result.VTable.Slots.Count > 0)
            {
                sb.AppendLine($"| Slot | Address | Size | Declared Name |");
                sb.AppendLine($"|------|---------|------|---------------|");

                foreach (var slot in result.VTable.Slots.Take(20)) // Limit to first 20 slots
                {
                    var size = slot.EstimatedSize.HasValue ? $"0x{slot.EstimatedSize.Value:X}" : "-";
                    sb.AppendLine($"| {slot.Index} | {slot.AddressHex} | {size} | {slot.DeclaredName ?? "-"} |");
                }

                if (result.VTable.Slots.Count > 20)
                    sb.AppendLine($"| ... | ({result.VTable.Slots.Count - 20} more slots) | | |");

                sb.AppendLine();
            }
        }

        return sb.ToString();
    }

    /// <summary>
    /// Export batch analysis results to Markdown report.
    /// </summary>
    public string ExportBatchToMarkdown(IEnumerable<AnalysisResult> results, string gameVersion)
    {
        var sb = new StringBuilder();
        var resultList = results.ToList();

        sb.AppendLine("# Batch Analysis Report");
        sb.AppendLine();
        sb.AppendLine($"**Generated:** {DateTime.UtcNow:yyyy-MM-dd HH:mm:ss}");
        sb.AppendLine($"**Game Version:** {gameVersion}");
        sb.AppendLine($"**Structs Analyzed:** {resultList.Count}");
        sb.AppendLine();

        // Summary
        var withIssues = resultList.Where(r =>
            r.Comparison?.MismatchCount > 0 ||
            r.Comparison?.UndocumentedCount > 0 ||
            (r.Discovery?.DeclaredSize != null && r.Discovery?.AnalyzedSize != r.Discovery?.DeclaredSize)).ToList();

        sb.AppendLine("## Summary");
        sb.AppendLine();
        sb.AppendLine($"| Metric | Count |");
        sb.AppendLine($"|--------|-------|");
        sb.AppendLine($"| Total Structs | {resultList.Count} |");
        sb.AppendLine($"| With Issues | {withIssues.Count} |");
        sb.AppendLine($"| Perfect Match | {resultList.Count - withIssues.Count} |");
        sb.AppendLine();

        if (withIssues.Count > 0)
        {
            sb.AppendLine("## Issues");
            sb.AppendLine();
            sb.AppendLine($"| Struct | Size Match | Type Mismatches | Undocumented |");
            sb.AppendLine($"|--------|------------|-----------------|--------------|");

            foreach (var result in withIssues.OrderByDescending(r => r.Comparison?.MismatchCount ?? 0 + r.Comparison?.UndocumentedCount ?? 0))
            {
                var sizeMatch = result.Discovery?.DeclaredSize == result.Discovery?.AnalyzedSize ? "Yes" : "No";
                sb.AppendLine($"| {result.StructName} | {sizeMatch} | {result.Comparison?.MismatchCount ?? 0} | {result.Comparison?.UndocumentedCount ?? 0} |");
            }
            sb.AppendLine();
        }

        return sb.ToString();
    }

    /// <summary>
    /// Get YAML type string for a discovered field.
    /// </summary>
    private static string GetYamlType(DiscoveredField field)
    {
        if (!string.IsNullOrEmpty(field.DeclaredType))
            return field.DeclaredType;

        return field.InferredType switch
        {
            Memory.InferredTypeKind.Bool => "bool",
            Memory.InferredTypeKind.Byte => "byte",
            Memory.InferredTypeKind.Int16 => "short",
            Memory.InferredTypeKind.Int32 => "int",
            Memory.InferredTypeKind.Int64 => "long",
            Memory.InferredTypeKind.Float => "float",
            Memory.InferredTypeKind.Double => "double",
            Memory.InferredTypeKind.Pointer => "void*",
            Memory.InferredTypeKind.VTablePointer => "void*",
            Memory.InferredTypeKind.StringPointer => "byte*",
            Memory.InferredTypeKind.Enum => "int",
            _ => "byte"
        };
    }
}
