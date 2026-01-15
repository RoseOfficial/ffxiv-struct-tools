using System;
using System.Text;

namespace StructValidator.Memory;

/// <summary>
/// Types that can be inferred from memory values.
/// </summary>
public enum InferredTypeKind
{
    Unknown,
    Padding,
    Bool,
    Byte,
    Int16,
    Int32,
    Int64,
    Float,
    Double,
    Pointer,
    VTablePointer,
    StringPointer,
    Utf8String,
    Enum,
    Array,
    Struct
}

/// <summary>
/// Result of type inference on a memory region.
/// </summary>
public class InferredType
{
    public InferredTypeKind Kind { get; set; }
    public float Confidence { get; set; }
    public string? Notes { get; set; }
    public int Size { get; set; }
    public string? DisplayValue { get; set; }

    public InferredType(InferredTypeKind kind, float confidence, int size = 0)
    {
        Kind = kind;
        Confidence = confidence;
        Size = size;
    }

    public override string ToString()
    {
        return Kind switch
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
            InferredTypeKind.Array => $"array[{Size}]",
            InferredTypeKind.Struct => $"struct({Size})",
            _ => "unknown"
        };
    }
}

/// <summary>
/// Infers types from memory values using heuristics.
/// </summary>
public static unsafe class TypeInference
{
    // Suspicious patterns that indicate uninitialized/debug memory
    private const uint UninitializedPattern = 0xCDCDCDCD;
    private const uint FreedPattern = 0xDDDDDDDD;
    private const uint AlignmentPattern = 0xFDFDFDFD;

    /// <summary>
    /// Infer the type of a value at the given address with specified size hint.
    /// </summary>
    public static InferredType InferType(nint address, int sizeHint)
    {
        if (!SafeMemoryReader.TryReadBytes(address, Math.Min(sizeHint, 8), out var bytes))
            return new InferredType(InferredTypeKind.Unknown, 0, sizeHint);

        // Check for all-zero padding
        if (IsAllZeros(bytes))
        {
            return new InferredType(InferredTypeKind.Padding, 0.6f, bytes.Length)
            {
                Notes = "All zeros - likely padding or unset"
            };
        }

        // Try 8-byte pointer detection first
        if (sizeHint >= 8)
        {
            if (SafeMemoryReader.TryReadPointer(address, out var ptrValue))
            {
                var ptrInfo = PointerValidator.Validate(ptrValue);
                if (ptrInfo.Result is PointerValidationResult.ValidHeap
                    or PointerValidationResult.ValidCode
                    or PointerValidationResult.ValidData)
                {
                    // Check if it's a vtable pointer (at offset 0, points to code section)
                    if (PointerValidator.IsInCodeSection(ptrValue))
                    {
                        return new InferredType(InferredTypeKind.VTablePointer, 0.9f, 8)
                        {
                            DisplayValue = $"0x{ptrValue:X}",
                            Notes = ptrInfo.TargetDescription
                        };
                    }

                    // Check if it points to a string
                    if (TryReadStringAt(ptrValue, out var str))
                    {
                        return new InferredType(InferredTypeKind.StringPointer, 0.85f, 8)
                        {
                            DisplayValue = $"\"{TruncateString(str, 32)}\"",
                            Notes = $"String pointer: {str.Length} chars"
                        };
                    }

                    return new InferredType(InferredTypeKind.Pointer, ptrInfo.Confidence, 8)
                    {
                        DisplayValue = $"0x{ptrValue:X}",
                        Notes = ptrInfo.TargetDescription
                    };
                }
            }
        }

        // Try 4-byte float detection
        if (sizeHint >= 4)
        {
            if (SafeMemoryReader.TryReadFloat(address, out var floatValue))
            {
                var confidence = EvaluateFloatConfidence(floatValue, bytes);
                if (confidence > 0.5f)
                {
                    return new InferredType(InferredTypeKind.Float, confidence, 4)
                    {
                        DisplayValue = floatValue.ToString("F4")
                    };
                }
            }

            // Check for suspicious patterns
            if (SafeMemoryReader.TryReadUInt32(address, out var uint32Value))
            {
                if (uint32Value is UninitializedPattern or FreedPattern or AlignmentPattern)
                {
                    return new InferredType(InferredTypeKind.Padding, 0.8f, 4)
                    {
                        Notes = "Debug pattern detected"
                    };
                }
            }
        }

        // Boolean detection (1-byte 0 or 1)
        if (sizeHint == 1)
        {
            if (SafeMemoryReader.TryReadByte(address, out var byteValue))
            {
                if (byteValue is 0 or 1)
                {
                    return new InferredType(InferredTypeKind.Bool, 0.5f, 1)
                    {
                        DisplayValue = (byteValue != 0).ToString()
                    };
                }

                // Small enum-like value
                if (byteValue < 32)
                {
                    return new InferredType(InferredTypeKind.Enum, 0.4f, 1)
                    {
                        DisplayValue = byteValue.ToString(),
                        Notes = "Small value - possible enum"
                    };
                }

                return new InferredType(InferredTypeKind.Byte, 0.3f, 1)
                {
                    DisplayValue = byteValue.ToString()
                };
            }
        }

        // 4-byte integer detection
        if (sizeHint >= 4)
        {
            if (SafeMemoryReader.TryReadInt32(address, out var int32Value))
            {
                // Small integers might be enums
                if (int32Value is >= 0 and < 256)
                {
                    return new InferredType(InferredTypeKind.Enum, 0.4f, 4)
                    {
                        DisplayValue = int32Value.ToString(),
                        Notes = "Small value - possible enum or index"
                    };
                }

                return new InferredType(InferredTypeKind.Int32, 0.3f, 4)
                {
                    DisplayValue = int32Value.ToString()
                };
            }
        }

        // 2-byte detection
        if (sizeHint >= 2)
        {
            if (SafeMemoryReader.TryReadInt16(address, out var int16Value))
            {
                return new InferredType(InferredTypeKind.Int16, 0.3f, 2)
                {
                    DisplayValue = int16Value.ToString()
                };
            }
        }

        return new InferredType(InferredTypeKind.Unknown, 0.1f, sizeHint);
    }

    /// <summary>
    /// Evaluate how likely a float value is valid game data.
    /// </summary>
    private static float EvaluateFloatConfidence(float value, byte[] bytes)
    {
        // Invalid floats
        if (float.IsNaN(value) || float.IsInfinity(value))
            return 0;

        // Check for suspicious bit patterns
        var uint32 = BitConverter.ToUInt32(bytes, 0);
        if (uint32 is UninitializedPattern or FreedPattern or AlignmentPattern)
            return 0;

        // Zero is valid but not conclusive
        if (value == 0)
            return 0.3f;

        // Normalized floats in game-relevant ranges
        // Coordinates: typically 0-2000
        // Angles: 0 to 2*PI (~6.28)
        // Percentages: 0 to 1 or 0 to 100
        // Scale factors: 0.001 to 1000

        if (value is > -1e6f and < 1e6f)
        {
            // "Nice" float values (likely designed values)
            if (IsNiceFloat(value))
                return 0.85f;

            return 0.7f;
        }

        // Extreme values are suspicious
        if (Math.Abs(value) > 1e10f)
            return 0.2f;

        return 0.5f;
    }

    /// <summary>
    /// Check if a float looks like an intentionally designed value.
    /// </summary>
    private static bool IsNiceFloat(float value)
    {
        // Check if close to common fractions
        float[] common = { 0.25f, 0.5f, 0.75f, 1.0f, 1.5f, 2.0f, 0.1f, 0.01f };
        foreach (var c in common)
        {
            if (Math.Abs(value - c) < 0.0001f || Math.Abs(value + c) < 0.0001f)
                return true;
        }

        // Check if close to an integer
        if (Math.Abs(value - Math.Round(value)) < 0.0001f)
            return true;

        // Check for PI-related values
        if (Math.Abs(value - Math.PI) < 0.01f ||
            Math.Abs(value - Math.PI * 2) < 0.01f ||
            Math.Abs(value - Math.PI / 2) < 0.01f)
            return true;

        return false;
    }

    /// <summary>
    /// Check if all bytes are zero.
    /// </summary>
    private static bool IsAllZeros(byte[] bytes)
    {
        foreach (var b in bytes)
            if (b != 0) return false;
        return true;
    }

    /// <summary>
    /// Try to read a null-terminated string at an address.
    /// </summary>
    private static bool TryReadStringAt(nint address, out string result)
    {
        result = "";

        if (!SafeMemoryReader.IsReadable(address))
            return false;

        try
        {
            var sb = new StringBuilder();
            int maxLen = 256;

            for (int i = 0; i < maxLen; i++)
            {
                if (!SafeMemoryReader.TryReadByte(address + i, out var b))
                    break;

                if (b == 0)
                {
                    // Valid null-terminated string
                    if (sb.Length >= 2)
                    {
                        result = sb.ToString();
                        return true;
                    }
                    break;
                }

                // ASCII printable range
                if (b is < 32 or > 126)
                {
                    // Not ASCII - might be UTF-8, but for simplicity we stop
                    break;
                }

                sb.Append((char)b);
            }
        }
        catch
        {
            // Ignore
        }

        return false;
    }

    private static string TruncateString(string s, int maxLen)
    {
        return s.Length <= maxLen ? s : s[..(maxLen - 3)] + "...";
    }
}
