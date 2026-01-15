using System;
using System.Collections.Generic;
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
/// Provides type interpretations for memory values.
///
/// IMPORTANT: This class provides multiple INTERPRETATIONS of bytes, not type DETECTION.
/// The same bytes can validly represent many different types (int, float, pointer, etc.).
/// Only code analysis can determine the actual type - not value inspection.
/// </summary>
public static unsafe class TypeInference
{
    // Suspicious patterns that indicate uninitialized/debug memory
    private const uint UninitializedPattern = 0xCDCDCDCD;
    private const uint FreedPattern = 0xDDDDDDDD;
    private const uint AlignmentPattern = 0xFDFDFDFD;

    /// <summary>
    /// Get all valid interpretations of bytes at the given address.
    /// All interpretations are shown equally - no "preferred" type is claimed.
    /// </summary>
    /// <param name="address">Memory address to read from.</param>
    /// <param name="maxSize">Maximum bytes to interpret (1-8).</param>
    /// <returns>All valid interpretations of the bytes.</returns>
    public static ByteInterpretations GetInterpretations(nint address, int maxSize = 8)
    {
        var result = new ByteInterpretations { Size = maxSize };

        // Read raw bytes
        if (!SafeMemoryReader.TryReadBytes(address, Math.Min(maxSize, 8), out var bytes))
        {
            result.RawBytes = Array.Empty<byte>();
            result.HexString = "(unreadable)";
            return result;
        }

        result.RawBytes = bytes;
        result.HexString = BitConverter.ToString(bytes).Replace("-", " ");

        // Factual observations
        result.IsAllZeros = IsAllZeros(bytes);
        if (bytes.Length >= 4)
        {
            var uint32 = BitConverter.ToUInt32(bytes, 0);
            result.IsDebugPattern = uint32 is UninitializedPattern or FreedPattern or AlignmentPattern;
        }

        // 1-byte interpretations
        if (bytes.Length >= 1)
        {
            result.AsInt8 = ((sbyte)bytes[0]).ToString();
            result.AsUInt8 = bytes[0].ToString();
        }

        // 2-byte interpretations
        if (bytes.Length >= 2)
        {
            result.AsInt16 = BitConverter.ToInt16(bytes, 0).ToString();
            result.AsUInt16 = BitConverter.ToUInt16(bytes, 0).ToString();
        }

        // 4-byte interpretations
        if (bytes.Length >= 4)
        {
            result.AsInt32 = BitConverter.ToInt32(bytes, 0).ToString();
            result.AsUInt32 = BitConverter.ToUInt32(bytes, 0).ToString();

            var floatVal = BitConverter.ToSingle(bytes, 0);
            result.FloatIsInvalid = float.IsNaN(floatVal) || float.IsInfinity(floatVal);
            result.AsFloat = result.FloatIsInvalid ? "(invalid)" : floatVal.ToString("G6");
        }

        // 8-byte interpretations
        if (bytes.Length >= 8)
        {
            result.AsInt64 = BitConverter.ToInt64(bytes, 0).ToString();
            result.AsUInt64 = BitConverter.ToUInt64(bytes, 0).ToString();

            var doubleVal = BitConverter.ToDouble(bytes, 0);
            var doubleInvalid = double.IsNaN(doubleVal) || double.IsInfinity(doubleVal);
            result.AsDouble = doubleInvalid ? "(invalid)" : doubleVal.ToString("G6");

            // Pointer interpretation
            var ptrValue = BitConverter.ToInt64(bytes, 0);
            result.PointerValue = (nint)ptrValue;
            if (ptrValue != 0)
            {
                var ptrInfo = PointerValidator.Validate((nint)ptrValue);
                result.IsValidPointer = ptrInfo.Result is PointerValidationResult.ValidHeap
                    or PointerValidationResult.ValidCode
                    or PointerValidationResult.ValidData;

                if (result.IsValidPointer)
                {
                    result.AsPointer = $"0x{ptrValue:X}";
                    result.PointerTargetDescription = ptrInfo.TargetDescription;
                }
                else
                {
                    result.AsPointer = $"0x{ptrValue:X} (invalid)";
                }
            }
            else
            {
                result.AsPointer = "null";
            }
        }

        return result;
    }

    /// <summary>
    /// Get detailed information about a pointer target.
    /// </summary>
    public static PointerTargetInfo GetPointerTargetInfo(nint address)
    {
        var info = new PointerTargetInfo { Address = address };

        if (address == 0)
        {
            info.RegionDescription = "null";
            return info;
        }

        var validation = PointerValidator.Validate(address);
        info.IsReadable = validation.Result != PointerValidationResult.Invalid;
        info.IsInCodeSection = PointerValidator.IsInCodeSection(address);
        info.IsInHeap = validation.Result == PointerValidationResult.ValidHeap;
        info.IsInDataSection = validation.Result == PointerValidationResult.ValidData;
        info.RegionDescription = validation.TargetDescription;

        return info;
    }

    /// <summary>
    /// Infer the type of a value at the given address with specified size hint.
    /// </summary>
    /// <remarks>
    /// DEPRECATED: This method uses confidence scores which create false precision.
    /// Prefer <see cref="GetInterpretations"/> which shows all interpretations equally.
    /// </remarks>
    [Obsolete("Use GetInterpretations() instead - confidence-based inference is unreliable")]
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

                    // Check if it points to a string (UTF-8 supported)
                    if (TryReadStringAt(ptrValue, out var str))
                    {
                        return new InferredType(InferredTypeKind.StringPointer, 0.85f, 8)
                        {
                            DisplayValue = $"\"{TruncateString(str, 32)}\"",
                            Notes = $"String pointer: {str.Length} chars"
                        };
                    }

                    // Check if this looks like a Utf8String struct
                    if (TryDetectUtf8StringStruct(ptrValue, out var utf8Str, out var utf8Conf))
                    {
                        return new InferredType(InferredTypeKind.Utf8String, utf8Conf, 8)
                        {
                            DisplayValue = $"\"{TruncateString(utf8Str, 32)}\"",
                            Notes = $"Utf8String: {utf8Str.Length} chars"
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
    /// Try to read a null-terminated string at an address, supporting UTF-8.
    /// </summary>
    private static bool TryReadStringAt(nint address, out string result)
    {
        result = "";

        if (!SafeMemoryReader.IsReadable(address))
            return false;

        try
        {
            const int maxLen = 512;
            var bytes = new List<byte>();
            int validChars = 0;

            for (int i = 0; i < maxLen; i++)
            {
                if (!SafeMemoryReader.TryReadByte(address + i, out var b))
                    break;

                if (b == 0)
                {
                    // Null terminator found
                    if (bytes.Count >= 2)
                    {
                        try
                        {
                            result = Encoding.UTF8.GetString(bytes.ToArray());
                            // Verify it decoded to reasonable text
                            if (validChars >= 2 && !ContainsInvalidCharacters(result))
                                return true;
                        }
                        catch
                        {
                            // Invalid UTF-8 sequence
                        }
                    }
                    break;
                }

                // Validate UTF-8 sequences
                int seqLen = GetUtf8SequenceLength(b);
                if (seqLen == 0)
                {
                    // Invalid start byte
                    break;
                }

                bytes.Add(b);

                // Read continuation bytes for multi-byte sequences
                if (seqLen > 1)
                {
                    bool validSequence = true;
                    for (int j = 1; j < seqLen; j++)
                    {
                        if (!SafeMemoryReader.TryReadByte(address + i + j, out var cont))
                        {
                            validSequence = false;
                            break;
                        }

                        // Continuation bytes must be 10xxxxxx
                        if ((cont & 0xC0) != 0x80)
                        {
                            validSequence = false;
                            break;
                        }

                        bytes.Add(cont);
                    }

                    if (!validSequence)
                        break;

                    i += seqLen - 1; // Advance past continuation bytes
                }

                validChars++;
            }
        }
        catch
        {
            // Ignore
        }

        return false;
    }

    /// <summary>
    /// Get the expected length of a UTF-8 sequence from its first byte.
    /// Returns 0 for invalid start bytes.
    /// </summary>
    private static int GetUtf8SequenceLength(byte b)
    {
        // ASCII: 0xxxxxxx
        if ((b & 0x80) == 0)
            return 1;

        // 2-byte: 110xxxxx
        if ((b & 0xE0) == 0xC0)
            return 2;

        // 3-byte: 1110xxxx
        if ((b & 0xF0) == 0xE0)
            return 3;

        // 4-byte: 11110xxx
        if ((b & 0xF8) == 0xF0)
            return 4;

        // Continuation byte or invalid
        return 0;
    }

    /// <summary>
    /// Check if string contains characters that suggest it's not real text.
    /// </summary>
    private static bool ContainsInvalidCharacters(string s)
    {
        foreach (char c in s)
        {
            // Allow common printable characters, CJK, and other valid Unicode
            if (char.IsControl(c) && c != '\t' && c != '\n' && c != '\r')
                return true;

            // Check for replacement character (indicates decoding failure)
            if (c == '\uFFFD')
                return true;
        }
        return false;
    }

    /// <summary>
    /// Try to detect FFXIV's Utf8String struct pattern.
    /// Layout: StringPtr(8) + BufSize(8) + BufUsed(8) + StringLength(8) + flags
    /// </summary>
    public static bool TryDetectUtf8StringStruct(nint address, out string result, out float confidence)
    {
        result = "";
        confidence = 0;

        if (!SafeMemoryReader.IsReadable(address))
            return false;

        try
        {
            // Read StringPtr at offset 0
            if (!SafeMemoryReader.TryReadPointer(address, out var stringPtr))
                return false;

            if (stringPtr == 0)
                return false;

            // Validate pointer is readable
            var ptrInfo = PointerValidator.Validate(stringPtr);
            if (ptrInfo.Result != PointerValidationResult.ValidHeap &&
                ptrInfo.Result != PointerValidationResult.ValidData)
                return false;

            // Read BufSize at offset 8
            if (!SafeMemoryReader.TryReadInt64(address + 8, out var bufSize))
                return false;

            // Read StringLength at offset 0x18
            if (!SafeMemoryReader.TryReadInt64(address + 0x18, out var stringLength))
                return false;

            // Validate sizes are reasonable
            if (bufSize <= 0 || bufSize > 1024 * 1024) // Max 1MB
                return false;

            if (stringLength < 0 || stringLength > bufSize)
                return false;

            // Try to read the actual string
            if (stringLength > 0 && TryReadStringAt(stringPtr, out result))
            {
                // Confidence based on how well sizes match
                if (result.Length == stringLength ||
                    Encoding.UTF8.GetByteCount(result) == stringLength)
                {
                    confidence = 0.9f;
                }
                else
                {
                    confidence = 0.7f;
                }
                return true;
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
