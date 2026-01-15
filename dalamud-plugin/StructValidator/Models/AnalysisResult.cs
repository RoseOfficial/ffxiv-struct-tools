using System;
using System.Collections.Generic;
using StructValidator.Discovery;

namespace StructValidator.Models;

/// <summary>
/// Unified result from analyzing a struct, combining discovery, comparison, and patterns.
/// </summary>
public class AnalysisResult
{
    /// <summary>
    /// Name of the struct analyzed.
    /// </summary>
    public string StructName { get; init; } = "";

    /// <summary>
    /// Base address where the struct was found.
    /// </summary>
    public nint Address { get; init; }

    /// <summary>
    /// Base address where the struct was found (as hex string).
    /// </summary>
    public string AddressHex { get; init; } = "";

    /// <summary>
    /// The discovered memory layout.
    /// </summary>
    public DiscoveredLayout? Discovery { get; init; }

    /// <summary>
    /// Comparison between discovered and declared fields.
    /// </summary>
    public LayoutComparisonResult? Comparison { get; init; }

    /// <summary>
    /// Detected array patterns in memory.
    /// </summary>
    public List<ArrayPattern>? DetectedArrays { get; init; }

    /// <summary>
    /// VTable analysis results.
    /// </summary>
    public VTableAnalysis? VTable { get; init; }

    /// <summary>
    /// When the analysis was performed.
    /// </summary>
    public DateTime Timestamp { get; init; } = DateTime.UtcNow;

    /// <summary>
    /// Game version at time of analysis.
    /// </summary>
    public string GameVersion { get; init; } = "";
}

/// <summary>
/// Detected array pattern in memory.
/// </summary>
public class ArrayPattern
{
    /// <summary>
    /// Offset where array starts.
    /// </summary>
    public int Offset { get; init; }

    /// <summary>
    /// Size of each element in bytes.
    /// </summary>
    public int Stride { get; init; }

    /// <summary>
    /// Number of elements detected.
    /// </summary>
    public int Count { get; init; }

    /// <summary>
    /// Total bytes covered by this array.
    /// </summary>
    public int TotalSize => Stride * Count;

    /// <summary>
    /// Confidence in this detection (0.0 - 1.0).
    /// </summary>
    public float Confidence { get; init; }

    /// <summary>
    /// Suggested field type for YAML.
    /// </summary>
    public string SuggestedType => $"FixedArray<byte, {Stride}>";
}

/// <summary>
/// VTable analysis results for a struct.
/// </summary>
public class VTableAnalysis
{
    /// <summary>
    /// VTable address (as hex string).
    /// </summary>
    public string AddressHex { get; init; } = "";

    /// <summary>
    /// Number of virtual function slots.
    /// </summary>
    public int SlotCount { get; init; }

    /// <summary>
    /// Confidence in vtable detection.
    /// </summary>
    public float Confidence { get; init; }

    /// <summary>
    /// Individual slot details.
    /// </summary>
    public List<VTableSlot> Slots { get; init; } = new();
}

/// <summary>
/// A single virtual function table slot.
/// </summary>
public class VTableSlot
{
    /// <summary>
    /// Slot index (0-based).
    /// </summary>
    public int Index { get; init; }

    /// <summary>
    /// Function address (as hex string).
    /// </summary>
    public string AddressHex { get; init; } = "";

    /// <summary>
    /// Estimated function size in bytes (distance to next function).
    /// </summary>
    public int? EstimatedSize { get; init; }

    /// <summary>
    /// Declared function name if known.
    /// </summary>
    public string? DeclaredName { get; init; }
}
