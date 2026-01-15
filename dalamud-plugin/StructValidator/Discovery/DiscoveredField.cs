using StructValidator.Memory;

namespace StructValidator.Discovery;

/// <summary>
/// Represents a field discovered through memory analysis.
/// </summary>
public class DiscoveredField
{
    /// <summary>
    /// Offset from the base address of the struct.
    /// </summary>
    public int Offset { get; set; }

    /// <summary>
    /// Size of the field in bytes.
    /// </summary>
    public int Size { get; set; }

    /// <summary>
    /// The inferred type of the field.
    /// </summary>
    public InferredTypeKind InferredType { get; set; }

    /// <summary>
    /// Confidence score for the type inference (0.0 to 1.0).
    /// </summary>
    public float Confidence { get; set; }

    /// <summary>
    /// Display-friendly value read from memory.
    /// </summary>
    public string? Value { get; set; }

    /// <summary>
    /// Additional notes about the inference.
    /// </summary>
    public string? Notes { get; set; }

    /// <summary>
    /// Raw bytes at this offset.
    /// </summary>
    public byte[]? RawBytes { get; set; }

    /// <summary>
    /// If this is a pointer, the address it points to.
    /// </summary>
    public nint? PointerTarget { get; set; }

    /// <summary>
    /// Name of the matching FFXIVClientStructs field, if any.
    /// </summary>
    public string? DeclaredName { get; set; }

    /// <summary>
    /// Type of the matching FFXIVClientStructs field, if any.
    /// </summary>
    public string? DeclaredType { get; set; }

    /// <summary>
    /// Whether this field matches a declared field.
    /// </summary>
    public bool HasMatch => !string.IsNullOrEmpty(DeclaredName);

    /// <summary>
    /// Get a display string for the inferred type.
    /// </summary>
    public string TypeString => InferredType switch
    {
        InferredTypeKind.Pointer => "void*",
        InferredTypeKind.VTablePointer => "vtable*",
        InferredTypeKind.StringPointer => "char*",
        InferredTypeKind.Utf8String => "Utf8String",
        InferredTypeKind.Float => "float",
        InferredTypeKind.Double => "double",
        InferredTypeKind.Bool => "bool",
        InferredTypeKind.Byte => "byte",
        InferredTypeKind.Int16 => "short",
        InferredTypeKind.Int32 => "int",
        InferredTypeKind.Int64 => "long",
        InferredTypeKind.Enum => "enum?",
        InferredTypeKind.Padding => "padding",
        InferredTypeKind.Array => "array",
        InferredTypeKind.Struct => "struct",
        _ => "unknown"
    };
}
