using System;
using System.Collections.Generic;
using StructValidator.Discovery;

namespace StructValidator.Memory;

/// <summary>
/// Orchestrates memory analysis to discover struct layouts.
/// </summary>
public static unsafe class MemoryAnalyzer
{
    /// <summary>
    /// Analyze a memory region starting at the given address.
    /// </summary>
    public static DiscoveredLayout Analyze(nint baseAddress, int size, string structName = "")
    {
        var layout = new DiscoveredLayout
        {
            StructName = structName,
            BaseAddress = baseAddress,
            AnalyzedSize = size,
            Timestamp = DateTime.UtcNow
        };

        if (baseAddress == 0 || size <= 0)
        {
            layout.Messages.Add("Invalid base address or size");
            return layout;
        }

        // Initialize pointer validator
        PointerValidator.Initialize();

        // Check for vtable at offset 0
        var vtableAnalysis = VTableDetector.AnalyzeVTable(baseAddress);
        if (vtableAnalysis.IsVTable)
        {
            layout.VTableAddress = vtableAnalysis.VTableAddress;
            layout.VTableSlotCount = vtableAnalysis.SlotCount;

            // Add vtable as first field
            layout.Fields.Add(new DiscoveredField
            {
                Offset = 0,
                Size = 8,
                InferredType = InferredTypeKind.VTablePointer,
                Confidence = vtableAnalysis.Confidence,
                Value = $"0x{vtableAnalysis.VTableAddress:X}",
                Notes = $"{vtableAnalysis.SlotCount} virtual functions"
            });
        }

        // Analyze the rest of the memory
        AnalyzeMemoryRegion(baseAddress, size, layout, vtableAnalysis.IsVTable ? 8 : 0);

        // Detect patterns
        var patterns = PatternRecognizer.DetectPatterns(baseAddress, size);

        // Update summary
        UpdateSummary(layout);

        return layout;
    }

    /// <summary>
    /// Analyze memory region and discover fields.
    /// </summary>
    private static void AnalyzeMemoryRegion(nint baseAddress, int totalSize, DiscoveredLayout layout, int startOffset)
    {
        int offset = startOffset;

        while (offset < totalSize)
        {
            // Try to infer type at this offset
            int remainingSize = totalSize - offset;
            int sizeHint = Math.Min(remainingSize, 8); // Start with 8-byte assumption

            var inferredType = TypeInference.InferType(baseAddress + offset, sizeHint);

            // Determine actual size to advance
            int fieldSize = inferredType.Size > 0 ? inferredType.Size : DetermineFieldSize(inferredType.Kind);

            // Skip padding regions
            if (inferredType.Kind == InferredTypeKind.Padding && inferredType.Size >= 4)
            {
                // Skip the padding but note it in the layout
                var existingPadding = layout.Fields.Find(f => f.Offset == offset);
                if (existingPadding == null)
                {
                    layout.Fields.Add(new DiscoveredField
                    {
                        Offset = offset,
                        Size = inferredType.Size,
                        InferredType = InferredTypeKind.Padding,
                        Confidence = inferredType.Confidence,
                        Notes = inferredType.Notes
                    });
                }
                offset += inferredType.Size;
                continue;
            }

            // Add discovered field
            if (inferredType.Kind != InferredTypeKind.Unknown || inferredType.Confidence > 0.2f)
            {
                var field = new DiscoveredField
                {
                    Offset = offset,
                    Size = fieldSize,
                    InferredType = inferredType.Kind,
                    Confidence = inferredType.Confidence,
                    Value = inferredType.DisplayValue,
                    Notes = inferredType.Notes
                };

                // Read raw bytes for the field
                if (SafeMemoryReader.TryReadBytes(baseAddress + offset, fieldSize, out var rawBytes))
                {
                    field.RawBytes = rawBytes;
                }

                // If it's a pointer, store the target
                if (inferredType.Kind is InferredTypeKind.Pointer or InferredTypeKind.VTablePointer or InferredTypeKind.StringPointer)
                {
                    if (SafeMemoryReader.TryReadPointer(baseAddress + offset, out var ptrTarget))
                    {
                        field.PointerTarget = ptrTarget;
                    }
                }

                layout.Fields.Add(field);
            }

            // Advance offset
            offset += fieldSize;

            // Align to next boundary if needed
            if (offset % 4 != 0 && offset < totalSize - 4)
            {
                // Check if there's padding to align
                int alignTo = ((offset + 3) / 4) * 4;
                int paddingSize = alignTo - offset;

                if (paddingSize > 0 && IsLikelyPadding(baseAddress + offset, paddingSize))
                {
                    layout.Fields.Add(new DiscoveredField
                    {
                        Offset = offset,
                        Size = paddingSize,
                        InferredType = InferredTypeKind.Padding,
                        Confidence = 0.5f,
                        Notes = "Alignment padding"
                    });
                    offset = alignTo;
                }
            }
        }
    }

    /// <summary>
    /// Determine default field size based on type kind.
    /// </summary>
    private static int DetermineFieldSize(InferredTypeKind kind)
    {
        return kind switch
        {
            InferredTypeKind.Pointer or InferredTypeKind.VTablePointer or InferredTypeKind.StringPointer => 8,
            InferredTypeKind.Float or InferredTypeKind.Int32 or InferredTypeKind.Enum => 4,
            InferredTypeKind.Double or InferredTypeKind.Int64 => 8,
            InferredTypeKind.Int16 => 2,
            InferredTypeKind.Bool or InferredTypeKind.Byte => 1,
            _ => 4 // Default to 4-byte chunks
        };
    }

    /// <summary>
    /// Check if a memory region is likely padding.
    /// </summary>
    private static bool IsLikelyPadding(nint address, int size)
    {
        if (!SafeMemoryReader.TryReadBytes(address, size, out var bytes))
            return false;

        // Check if all zeros or all same debug pattern
        byte first = bytes[0];
        bool allSame = true;
        foreach (var b in bytes)
        {
            if (b != first)
            {
                allSame = false;
                break;
            }
        }

        return allSame && (first == 0 || first == 0xCD || first == 0xDD);
    }

    /// <summary>
    /// Update the summary statistics for a layout.
    /// </summary>
    private static void UpdateSummary(DiscoveredLayout layout)
    {
        layout.Summary.TotalFields = layout.Fields.Count;
        layout.Summary.HighConfidenceFields = 0;
        layout.Summary.PointerCount = 0;
        layout.Summary.PaddingBytes = 0;

        foreach (var field in layout.Fields)
        {
            if (field.Confidence > 0.7f)
                layout.Summary.HighConfidenceFields++;

            if (field.InferredType is InferredTypeKind.Pointer or InferredTypeKind.VTablePointer or InferredTypeKind.StringPointer)
                layout.Summary.PointerCount++;

            if (field.InferredType == InferredTypeKind.Padding)
                layout.Summary.PaddingBytes += field.Size;

            // Count undocumented (no match to FFXIVClientStructs)
            if (!field.HasMatch && field.InferredType != InferredTypeKind.Padding)
                layout.Summary.UndocumentedFields++;
        }
    }
}
