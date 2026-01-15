using System;
using System.Collections.Generic;

namespace StructValidator.Models;

/// <summary>
/// A snapshot of struct definitions at a specific game version.
/// </summary>
public class VersionSnapshot
{
    /// <summary>
    /// Game version string (e.g., "7.1.0").
    /// </summary>
    public string GameVersion { get; init; } = "";

    /// <summary>
    /// When the snapshot was created.
    /// </summary>
    public DateTime Timestamp { get; init; } = DateTime.UtcNow;

    /// <summary>
    /// Struct summaries captured at this version.
    /// </summary>
    public List<StructSnapshot> Structs { get; init; } = new();

    /// <summary>
    /// Total number of structs in this snapshot.
    /// </summary>
    public int StructCount => Structs.Count;

    /// <summary>
    /// Optional notes about this version.
    /// </summary>
    public string? Notes { get; init; }
}

/// <summary>
/// Summary of a single struct at a specific version.
/// </summary>
public class StructSnapshot
{
    /// <summary>
    /// Full struct name including namespace.
    /// </summary>
    public string FullName { get; init; } = "";

    /// <summary>
    /// Short struct name without namespace.
    /// </summary>
    public string Name { get; init; } = "";

    /// <summary>
    /// Declared size of the struct.
    /// </summary>
    public int? Size { get; init; }

    /// <summary>
    /// VTable address if detected (as hex string).
    /// </summary>
    public string? VTableAddressHex { get; init; }

    /// <summary>
    /// Number of vtable slots if detected.
    /// </summary>
    public int? VTableSlotCount { get; init; }

    /// <summary>
    /// Field summaries for quick comparison.
    /// </summary>
    public List<FieldSnapshot> Fields { get; init; } = new();
}

/// <summary>
/// Summary of a single field at a specific version.
/// </summary>
public class FieldSnapshot
{
    /// <summary>
    /// Field name.
    /// </summary>
    public string Name { get; init; } = "";

    /// <summary>
    /// Field offset.
    /// </summary>
    public int Offset { get; init; }

    /// <summary>
    /// Field type.
    /// </summary>
    public string Type { get; init; } = "";

    /// <summary>
    /// Field size.
    /// </summary>
    public int? Size { get; init; }
}

/// <summary>
/// Result of comparing two version snapshots.
/// </summary>
public class VersionDiff
{
    /// <summary>
    /// Old version being compared.
    /// </summary>
    public string OldVersion { get; init; } = "";

    /// <summary>
    /// New version being compared.
    /// </summary>
    public string NewVersion { get; init; } = "";

    /// <summary>
    /// Structs with size changes.
    /// </summary>
    public List<SizeChange> SizeChanges { get; init; } = new();

    /// <summary>
    /// Detected bulk offset shift patterns.
    /// </summary>
    public List<OffsetPattern> OffsetPatterns { get; init; } = new();

    /// <summary>
    /// VTable slot changes.
    /// </summary>
    public List<VTableChange> VTableChanges { get; init; } = new();

    /// <summary>
    /// New structs in the new version.
    /// </summary>
    public List<string> NewStructs { get; init; } = new();

    /// <summary>
    /// Structs removed in the new version.
    /// </summary>
    public List<string> RemovedStructs { get; init; } = new();
}

/// <summary>
/// A struct size change between versions.
/// </summary>
public class SizeChange
{
    public string StructName { get; init; } = "";
    public int? OldSize { get; init; }
    public int? NewSize { get; init; }
    public int? Delta => (NewSize ?? 0) - (OldSize ?? 0);
}

/// <summary>
/// A detected bulk offset shift pattern.
/// </summary>
public class OffsetPattern
{
    /// <summary>
    /// Description of the pattern.
    /// </summary>
    public string Description { get; init; } = "";

    /// <summary>
    /// Offset delta detected.
    /// </summary>
    public int Delta { get; init; }

    /// <summary>
    /// Starting offset where the shift begins.
    /// </summary>
    public int? StartOffset { get; init; }

    /// <summary>
    /// Structs affected by this pattern.
    /// </summary>
    public List<string> AffectedStructs { get; init; } = new();

    /// <summary>
    /// Confidence in this pattern (0.0 - 1.0).
    /// </summary>
    public float Confidence { get; init; }
}

/// <summary>
/// A VTable slot change between versions.
/// </summary>
public class VTableChange
{
    public string StructName { get; init; } = "";
    public int OldSlotCount { get; init; }
    public int NewSlotCount { get; init; }
    public int? SlotShift { get; init; }
}
