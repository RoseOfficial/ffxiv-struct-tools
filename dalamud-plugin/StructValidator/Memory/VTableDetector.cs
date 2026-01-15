using System.Collections.Generic;

namespace StructValidator.Memory;

/// <summary>
/// Result of VTable analysis.
/// </summary>
public class VTableAnalysis
{
    /// <summary>
    /// Address of the vtable.
    /// </summary>
    public nint VTableAddress { get; set; }

    /// <summary>
    /// Whether a valid vtable was detected.
    /// </summary>
    public bool IsVTable { get; set; }

    /// <summary>
    /// Number of function slots in the vtable.
    /// </summary>
    public int SlotCount { get; set; }

    /// <summary>
    /// Confidence score for vtable detection.
    /// </summary>
    public float Confidence { get; set; }

    /// <summary>
    /// Function pointers found in the vtable.
    /// </summary>
    public List<nint> FunctionPointers { get; set; } = new();
}

/// <summary>
/// Detects and analyzes virtual function tables.
/// </summary>
public static unsafe class VTableDetector
{
    private const int MaxVTableSlots = 500; // Safety limit
    private const int MinVTableSlots = 3;   // Minimum to be considered a vtable

    /// <summary>
    /// Analyze potential vtable at the given object address.
    /// Assumes vtable pointer is at offset 0.
    /// </summary>
    public static VTableAnalysis AnalyzeVTable(nint objectAddress)
    {
        var result = new VTableAnalysis();

        if (objectAddress == 0)
            return result;

        // Read vtable pointer at offset 0
        if (!SafeMemoryReader.TryReadPointer(objectAddress, out var vtablePtr))
            return result;

        if (vtablePtr == 0)
            return result;

        result.VTableAddress = vtablePtr;

        // VTable should be in code/data section of the game module
        if (!PointerValidator.IsInCodeSection(vtablePtr))
        {
            result.Confidence = 0.1f;
            return result;
        }

        // Count consecutive function pointers
        int slotCount = 0;
        while (slotCount < MaxVTableSlots)
        {
            nint slotAddress = vtablePtr + slotCount * 8;

            if (!SafeMemoryReader.TryReadPointer(slotAddress, out var funcPtr))
                break;

            // Function pointers should point to code section
            if (funcPtr == 0 || !PointerValidator.IsInCodeSection(funcPtr))
                break;

            result.FunctionPointers.Add(funcPtr);
            slotCount++;
        }

        result.SlotCount = slotCount;
        result.IsVTable = slotCount >= MinVTableSlots;

        // Calculate confidence based on slot count
        if (result.IsVTable)
        {
            // More slots = higher confidence (up to a point)
            result.Confidence = slotCount switch
            {
                >= 100 => 0.95f,
                >= 50 => 0.90f,
                >= 20 => 0.85f,
                >= 10 => 0.80f,
                >= 5 => 0.75f,
                _ => 0.70f
            };
        }
        else
        {
            result.Confidence = 0.2f;
        }

        return result;
    }

    /// <summary>
    /// Quick check if an object has a vtable.
    /// </summary>
    public static bool HasVTable(nint objectAddress)
    {
        var analysis = AnalyzeVTable(objectAddress);
        return analysis.IsVTable;
    }
}
