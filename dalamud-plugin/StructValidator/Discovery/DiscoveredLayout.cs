using System;
using System.Collections.Generic;
using System.Text.Json.Serialization;

namespace StructValidator.Discovery;

/// <summary>
/// Represents a struct layout discovered through memory analysis.
/// </summary>
public class DiscoveredLayout
{
    /// <summary>
    /// Name of the struct from FFXIVClientStructs.
    /// </summary>
    public string StructName { get; set; } = "";

    /// <summary>
    /// Base address where this struct instance was found.
    /// </summary>
    [JsonIgnore]
    public nint BaseAddress { get; set; }

    /// <summary>
    /// Base address as hex string for JSON serialization.
    /// </summary>
    [JsonPropertyName("baseAddress")]
    public string BaseAddressHex => $"0x{BaseAddress:X}";

    /// <summary>
    /// Total size analyzed.
    /// </summary>
    public int AnalyzedSize { get; set; }

    /// <summary>
    /// Declared size from FFXIVClientStructs (if available).
    /// </summary>
    public int? DeclaredSize { get; set; }

    /// <summary>
    /// When the analysis was performed.
    /// </summary>
    public DateTime Timestamp { get; set; }

    /// <summary>
    /// VTable address if detected at offset 0.
    /// </summary>
    [JsonIgnore]
    public nint? VTableAddress { get; set; }

    /// <summary>
    /// VTable address as hex string for JSON serialization.
    /// </summary>
    [JsonPropertyName("vtableAddress")]
    public string? VTableAddressHex => VTableAddress.HasValue ? $"0x{VTableAddress.Value:X}" : null;

    /// <summary>
    /// Number of vtable slots if vtable was detected.
    /// </summary>
    public int? VTableSlotCount { get; set; }

    /// <summary>
    /// Discovered fields in this struct.
    /// </summary>
    public List<DiscoveredField> Fields { get; set; } = new();

    /// <summary>
    /// Analysis summary statistics.
    /// </summary>
    public DiscoverySummary Summary { get; set; } = new();

    /// <summary>
    /// Any errors or warnings during analysis.
    /// </summary>
    public List<string> Messages { get; set; } = new();
}

/// <summary>
/// Summary statistics for a discovery analysis.
/// </summary>
public class DiscoverySummary
{
    /// <summary>
    /// Total fields discovered.
    /// </summary>
    public int TotalFields { get; set; }

    /// <summary>
    /// Fields with high confidence (> 0.7).
    /// </summary>
    public int HighConfidenceFields { get; set; }

    /// <summary>
    /// Fields that match declared FFXIVClientStructs fields.
    /// </summary>
    public int MatchedFields { get; set; }

    /// <summary>
    /// Fields that don't match any declared field (undocumented).
    /// </summary>
    public int UndocumentedFields { get; set; }

    /// <summary>
    /// Bytes identified as padding.
    /// </summary>
    public int PaddingBytes { get; set; }

    /// <summary>
    /// Pointers found.
    /// </summary>
    public int PointerCount { get; set; }
}

/// <summary>
/// Complete discovery report for export.
/// </summary>
public class DiscoveryReport
{
    public DateTime Timestamp { get; set; }
    public string GameVersion { get; set; } = "";
    public List<DiscoveredLayout> Layouts { get; set; } = new();
    public DiscoveryReportSummary Summary { get; set; } = new();
}

/// <summary>
/// Summary for a complete discovery report.
/// </summary>
public class DiscoveryReportSummary
{
    public int TotalStructsAnalyzed { get; set; }
    public int TotalFieldsDiscovered { get; set; }
    public int TotalUndocumentedFields { get; set; }
    public int TotalPointersFound { get; set; }
}
