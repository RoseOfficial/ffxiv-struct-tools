using System;
using System.Collections.Generic;

namespace StructValidator.Models;

/// <summary>
/// Collection of signatures for struct fields, used for post-patch offset detection.
/// </summary>
public class SignatureCollection
{
    /// <summary>
    /// Game version when signatures were generated.
    /// </summary>
    public string GameVersion { get; init; } = "";

    /// <summary>
    /// When the signatures were generated.
    /// </summary>
    public DateTime Timestamp { get; init; } = DateTime.UtcNow;

    /// <summary>
    /// Individual field signatures.
    /// </summary>
    public List<FieldSignature> Signatures { get; init; } = new();

    /// <summary>
    /// Total number of signatures.
    /// </summary>
    public int Count => Signatures.Count;
}

/// <summary>
/// A signature for locating a specific struct field in the game binary.
/// </summary>
public class FieldSignature
{
    /// <summary>
    /// Struct name this field belongs to.
    /// </summary>
    public string StructName { get; init; } = "";

    /// <summary>
    /// Field name.
    /// </summary>
    public string FieldName { get; init; } = "";

    /// <summary>
    /// Field offset at time of signature generation.
    /// </summary>
    public int Offset { get; init; }

    /// <summary>
    /// The byte pattern with wildcards (e.g., "48 8B ?? ?? ?? ?? 48 8B 41 20").
    /// Uses ?? for wildcard bytes.
    /// </summary>
    public string Pattern { get; init; } = "";

    /// <summary>
    /// Offset within the pattern where the field offset bytes are located.
    /// </summary>
    public int OffsetPosition { get; init; }

    /// <summary>
    /// Size of the offset value in bytes (typically 1 or 4).
    /// </summary>
    public int OffsetSize { get; init; }

    /// <summary>
    /// Instruction type that references this field.
    /// </summary>
    public SignatureInstructionType InstructionType { get; init; }

    /// <summary>
    /// Confidence in this signature's uniqueness (0.0 - 1.0).
    /// </summary>
    public float Confidence { get; init; }

    /// <summary>
    /// Number of matches found in code section during generation.
    /// Lower is better (1 = unique).
    /// </summary>
    public int MatchCount { get; init; }

    /// <summary>
    /// Address where this signature was found (as hex string).
    /// </summary>
    public string? FoundAtHex { get; init; }
}

/// <summary>
/// Type of instruction that references a field.
/// </summary>
public enum SignatureInstructionType
{
    /// <summary>
    /// Unknown instruction type.
    /// </summary>
    Unknown,

    /// <summary>
    /// MOV instruction reading from field (e.g., mov rax, [rcx+offset]).
    /// </summary>
    MovRead,

    /// <summary>
    /// MOV instruction writing to field (e.g., mov [rcx+offset], rax).
    /// </summary>
    MovWrite,

    /// <summary>
    /// LEA instruction getting field address (e.g., lea rax, [rcx+offset]).
    /// </summary>
    Lea,

    /// <summary>
    /// SSE/AVX instruction reading float (e.g., movss xmm0, [rcx+offset]).
    /// </summary>
    SseRead,

    /// <summary>
    /// SSE/AVX instruction writing float (e.g., movss [rcx+offset], xmm0).
    /// </summary>
    SseWrite,

    /// <summary>
    /// CMP instruction comparing field value.
    /// </summary>
    Compare,

    /// <summary>
    /// ADD/SUB instruction modifying field.
    /// </summary>
    Arithmetic
}

/// <summary>
/// Result of scanning for a signature in a new binary.
/// </summary>
public class SignatureScanResult
{
    /// <summary>
    /// The signature that was scanned.
    /// </summary>
    public FieldSignature Signature { get; init; } = null!;

    /// <summary>
    /// Whether the signature was found.
    /// </summary>
    public bool Found { get; init; }

    /// <summary>
    /// New offset detected (if different from original).
    /// </summary>
    public int? NewOffset { get; init; }

    /// <summary>
    /// Offset change from original.
    /// </summary>
    public int? OffsetDelta => NewOffset.HasValue ? NewOffset.Value - Signature.Offset : null;

    /// <summary>
    /// Address where signature was found (as hex string).
    /// </summary>
    public string? FoundAtHex { get; init; }

    /// <summary>
    /// Error message if scan failed.
    /// </summary>
    public string? Error { get; init; }
}
