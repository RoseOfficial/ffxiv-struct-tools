using System.Collections.Generic;

namespace StructValidator.Memory;

/// <summary>
/// Represents a detected array pattern in memory.
/// </summary>
public class ArrayPattern
{
    public int StartOffset { get; set; }
    public int Stride { get; set; }
    public int Count { get; set; }
    public float Confidence { get; set; }
}

/// <summary>
/// Represents a detected padding region.
/// </summary>
public class PaddingRegion
{
    public int StartOffset { get; set; }
    public int EndOffset { get; set; }
    public int Size => EndOffset - StartOffset;
    public bool IsZeroPadding { get; set; }
}

/// <summary>
/// Result of pattern recognition on a memory region.
/// </summary>
public class PatternResult
{
    public List<ArrayPattern> ArrayPatterns { get; set; } = new();
    public List<PaddingRegion> PaddingRegions { get; set; } = new();
    public List<(int Offset, string Value)> InlineStrings { get; set; } = new();
}

/// <summary>
/// Recognizes patterns in memory such as arrays, padding, and inline strings.
/// </summary>
public static unsafe class PatternRecognizer
{
    /// <summary>
    /// Detect patterns in a memory region.
    /// </summary>
    public static PatternResult DetectPatterns(nint baseAddress, int size)
    {
        var result = new PatternResult();

        if (baseAddress == 0 || size <= 0)
            return result;

        if (!SafeMemoryReader.TryReadBytes(baseAddress, size, out var bytes))
            return result;

        // Detect padding regions
        DetectPadding(bytes, result);

        // Detect array patterns (look for repeating structures)
        DetectArrays(bytes, result);

        return result;
    }

    /// <summary>
    /// Detect zero-padding and alignment padding regions.
    /// </summary>
    private static void DetectPadding(byte[] bytes, PatternResult result)
    {
        int i = 0;
        while (i < bytes.Length)
        {
            // Look for runs of zeros
            if (bytes[i] == 0)
            {
                int start = i;
                while (i < bytes.Length && bytes[i] == 0)
                    i++;

                int runLength = i - start;

                // Minimum 4 consecutive zeros to be considered padding
                if (runLength >= 4)
                {
                    result.PaddingRegions.Add(new PaddingRegion
                    {
                        StartOffset = start,
                        EndOffset = i,
                        IsZeroPadding = true
                    });
                }
            }
            // Look for debug patterns (0xCD, 0xDD, etc.)
            else if (bytes[i] is 0xCD or 0xDD or 0xFD)
            {
                byte pattern = bytes[i];
                int start = i;
                while (i < bytes.Length && bytes[i] == pattern)
                    i++;

                int runLength = i - start;

                if (runLength >= 4)
                {
                    result.PaddingRegions.Add(new PaddingRegion
                    {
                        StartOffset = start,
                        EndOffset = i,
                        IsZeroPadding = false
                    });
                }
            }
            else
            {
                i++;
            }
        }
    }

    /// <summary>
    /// Detect array patterns (repeating structures).
    /// </summary>
    private static void DetectArrays(byte[] bytes, PatternResult result)
    {
        // Try different strides (common struct sizes)
        int[] stridesToTry = { 4, 8, 16, 24, 32, 48, 64, 128 };

        foreach (var stride in stridesToTry)
        {
            if (stride >= bytes.Length / 3)
                continue; // Need at least 3 elements

            // Look for repeating patterns at each offset
            for (int startOffset = 0; startOffset < stride && startOffset < bytes.Length - stride * 3; startOffset += 8)
            {
                int repeatCount = CountRepeatingPattern(bytes, startOffset, stride);

                if (repeatCount >= 3)
                {
                    // Calculate confidence based on repeat count and stride
                    float confidence = CalculateArrayConfidence(stride, repeatCount, bytes.Length);

                    if (confidence > 0.5f)
                    {
                        result.ArrayPatterns.Add(new ArrayPattern
                        {
                            StartOffset = startOffset,
                            Stride = stride,
                            Count = repeatCount,
                            Confidence = confidence
                        });
                    }
                }
            }
        }
    }

    /// <summary>
    /// Count how many times a pattern repeats.
    /// </summary>
    private static int CountRepeatingPattern(byte[] bytes, int startOffset, int stride)
    {
        if (startOffset + stride * 2 >= bytes.Length)
            return 0;

        int count = 1;
        int maxCount = (bytes.Length - startOffset) / stride;

        for (int i = 1; i < maxCount && i < 100; i++) // Cap at 100 elements
        {
            int offset1 = startOffset + (i - 1) * stride;
            int offset2 = startOffset + i * stride;

            if (offset2 + stride > bytes.Length)
                break;

            // Check if the structure looks similar
            // We use a heuristic: check if pointer-like values are at same relative positions
            bool similar = CheckStructureSimilarity(bytes, offset1, offset2, stride);

            if (similar)
                count++;
            else
                break;
        }

        return count;
    }

    /// <summary>
    /// Check if two memory regions have similar structure.
    /// </summary>
    private static bool CheckStructureSimilarity(byte[] bytes, int offset1, int offset2, int stride)
    {
        // Simple heuristic: check if pointer-sized values at 8-byte boundaries
        // have similar characteristics (both zero, both non-zero, both look like pointers)

        int differences = 0;
        int checks = 0;

        for (int i = 0; i < stride && i + 8 <= stride; i += 8)
        {
            checks++;

            if (offset1 + i + 8 > bytes.Length || offset2 + i + 8 > bytes.Length)
                break;

            ulong val1 = 0, val2 = 0;
            for (int j = 0; j < 8; j++)
            {
                val1 |= (ulong)bytes[offset1 + i + j] << (j * 8);
                val2 |= (ulong)bytes[offset2 + i + j] << (j * 8);
            }

            // Both zero or both non-zero is similar
            bool bothZero = val1 == 0 && val2 == 0;
            bool bothNonZero = val1 != 0 && val2 != 0;

            if (!bothZero && !bothNonZero)
                differences++;
        }

        // Allow some differences (25%)
        return checks > 0 && (float)differences / checks < 0.25f;
    }

    /// <summary>
    /// Calculate confidence for an array detection.
    /// </summary>
    private static float CalculateArrayConfidence(int stride, int repeatCount, int totalSize)
    {
        // Higher repeat count = higher confidence
        float countScore = repeatCount switch
        {
            >= 20 => 0.95f,
            >= 10 => 0.85f,
            >= 5 => 0.75f,
            >= 3 => 0.65f,
            _ => 0.5f
        };

        // Larger coverage of total size = higher confidence
        float coverage = (float)(stride * repeatCount) / totalSize;
        float coverageScore = coverage > 0.5f ? 0.9f : 0.7f;

        // Common strides get a bonus
        float strideBonus = stride switch
        {
            8 or 16 or 32 or 64 => 1.1f,
            _ => 1.0f
        };

        return System.Math.Min(0.95f, countScore * coverageScore * strideBonus * 0.9f);
    }
}
