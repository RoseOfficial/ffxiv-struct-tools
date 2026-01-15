namespace StructValidator.Discovery;

/// <summary>
/// Represents a navigation entry in the memory exploration history.
/// </summary>
public class NavigationEntry
{
    /// <summary>
    /// The memory address being explored.
    /// </summary>
    public nint Address { get; set; }

    /// <summary>
    /// The size of the memory region to analyze.
    /// </summary>
    public int Size { get; set; }

    /// <summary>
    /// Optional full type name from FFXIVClientStructs for better field matching.
    /// </summary>
    public string? TypeName { get; set; }

    /// <summary>
    /// Display name for the breadcrumb (struct name or hex address).
    /// </summary>
    public string DisplayName { get; set; } = "";

    /// <summary>
    /// The field name that led to this navigation (for breadcrumb context).
    /// </summary>
    public string? SourceField { get; set; }

    /// <summary>
    /// The offset in the parent struct where this pointer was found.
    /// </summary>
    public int? SourceOffset { get; set; }

    /// <summary>
    /// Create a navigation entry for a singleton struct.
    /// </summary>
    public static NavigationEntry FromSingleton(nint address, int size, string fullTypeName)
    {
        var shortName = fullTypeName.Contains('.')
            ? fullTypeName[(fullTypeName.LastIndexOf('.') + 1)..]
            : fullTypeName;

        return new NavigationEntry
        {
            Address = address,
            Size = size,
            TypeName = fullTypeName,
            DisplayName = shortName
        };
    }

    /// <summary>
    /// Create a navigation entry for a pointer target.
    /// </summary>
    public static NavigationEntry FromPointer(nint address, int size, string? typeName, string sourceField, int sourceOffset)
    {
        var displayName = typeName != null && typeName.Contains('.')
            ? typeName[(typeName.LastIndexOf('.') + 1)..]
            : $"0x{address:X}";

        return new NavigationEntry
        {
            Address = address,
            Size = size,
            TypeName = typeName,
            DisplayName = displayName,
            SourceField = sourceField,
            SourceOffset = sourceOffset
        };
    }

    /// <summary>
    /// Create a navigation entry for manual address entry.
    /// </summary>
    public static NavigationEntry FromAddress(nint address, int size, string? typeName = null)
    {
        var displayName = typeName != null && typeName.Contains('.')
            ? typeName[(typeName.LastIndexOf('.') + 1)..]
            : $"0x{address:X}";

        return new NavigationEntry
        {
            Address = address,
            Size = size,
            TypeName = typeName,
            DisplayName = displayName
        };
    }
}
