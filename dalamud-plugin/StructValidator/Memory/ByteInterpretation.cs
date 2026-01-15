using System;

namespace StructValidator.Memory;

/// <summary>
/// Represents multiple valid interpretations of bytes at a memory address.
/// All interpretations are shown equally - no "preferred" or "most likely" type.
/// The human decides what type the data actually is based on code analysis.
/// </summary>
public class ByteInterpretations
{
    /// <summary>
    /// Raw bytes read from memory.
    /// </summary>
    public byte[] RawBytes { get; set; } = Array.Empty<byte>();

    /// <summary>
    /// Hex representation of the raw bytes.
    /// </summary>
    public string HexString { get; set; } = "";

    // === Integer Interpretations (all shown equally) ===

    /// <summary>
    /// Interpreted as signed 8-bit integer.
    /// </summary>
    public string? AsInt8 { get; set; }

    /// <summary>
    /// Interpreted as unsigned 8-bit integer.
    /// </summary>
    public string? AsUInt8 { get; set; }

    /// <summary>
    /// Interpreted as signed 16-bit integer (little-endian).
    /// </summary>
    public string? AsInt16 { get; set; }

    /// <summary>
    /// Interpreted as unsigned 16-bit integer (little-endian).
    /// </summary>
    public string? AsUInt16 { get; set; }

    /// <summary>
    /// Interpreted as signed 32-bit integer (little-endian).
    /// </summary>
    public string? AsInt32 { get; set; }

    /// <summary>
    /// Interpreted as unsigned 32-bit integer (little-endian).
    /// </summary>
    public string? AsUInt32 { get; set; }

    /// <summary>
    /// Interpreted as signed 64-bit integer (little-endian).
    /// </summary>
    public string? AsInt64 { get; set; }

    /// <summary>
    /// Interpreted as unsigned 64-bit integer (little-endian).
    /// </summary>
    public string? AsUInt64 { get; set; }

    // === Floating Point Interpretations ===

    /// <summary>
    /// Interpreted as 32-bit IEEE 754 float.
    /// </summary>
    public string? AsFloat { get; set; }

    /// <summary>
    /// Interpreted as 64-bit IEEE 754 double.
    /// </summary>
    public string? AsDouble { get; set; }

    // === Pointer Interpretation ===

    /// <summary>
    /// Interpreted as 64-bit pointer address.
    /// </summary>
    public string? AsPointer { get; set; }

    /// <summary>
    /// If AsPointer is set, the raw pointer value.
    /// </summary>
    public nint PointerValue { get; set; }

    // === String Interpretations ===

    /// <summary>
    /// Interpreted as ASCII string (if valid).
    /// </summary>
    public string? AsAscii { get; set; }

    /// <summary>
    /// Interpreted as UTF-8 string (if valid).
    /// </summary>
    public string? AsUtf8 { get; set; }

    // === Factual Observations (not guesses) ===

    /// <summary>
    /// Whether the bytes form a valid readable pointer address.
    /// This is a factual check, not a type guess.
    /// </summary>
    public bool IsValidPointer { get; set; }

    /// <summary>
    /// Description of what the pointer points to (if IsValidPointer is true).
    /// </summary>
    public string? PointerTargetDescription { get; set; }

    /// <summary>
    /// Whether all bytes are zero.
    /// This is a factual observation, not a type inference.
    /// </summary>
    public bool IsAllZeros { get; set; }

    /// <summary>
    /// Whether bytes match a known debug/uninitialized pattern (0xCD, 0xDD, 0xFD).
    /// This is a factual observation.
    /// </summary>
    public bool IsDebugPattern { get; set; }

    /// <summary>
    /// Whether the float interpretation would be NaN or Infinity.
    /// </summary>
    public bool FloatIsInvalid { get; set; }

    /// <summary>
    /// Number of bytes this interpretation covers.
    /// </summary>
    public int Size { get; set; }

    // === Declared Type (from FFXIVClientStructs) ===

    /// <summary>
    /// The declared type from FFXIVClientStructs, if this offset matches a known field.
    /// </summary>
    public string? DeclaredType { get; set; }

    /// <summary>
    /// The declared field name from FFXIVClientStructs, if matched.
    /// </summary>
    public string? DeclaredName { get; set; }

    /// <summary>
    /// Whether this offset matches a declared field.
    /// </summary>
    public bool HasDeclaredMatch => !string.IsNullOrEmpty(DeclaredName);
}

/// <summary>
/// Factual information about a pointer target.
/// These are observations, not guesses.
/// </summary>
public class PointerTargetInfo
{
    /// <summary>
    /// The pointer address.
    /// </summary>
    public nint Address { get; set; }

    /// <summary>
    /// Whether the pointer target is readable memory.
    /// </summary>
    public bool IsReadable { get; set; }

    /// <summary>
    /// Whether the target is in the code section (might be vtable or function).
    /// </summary>
    public bool IsInCodeSection { get; set; }

    /// <summary>
    /// Whether the target is in heap memory.
    /// </summary>
    public bool IsInHeap { get; set; }

    /// <summary>
    /// Whether the target is in data section.
    /// </summary>
    public bool IsInDataSection { get; set; }

    /// <summary>
    /// Human-readable description of the target region.
    /// </summary>
    public string? RegionDescription { get; set; }
}
